import { z } from "zod";

// A new holder has this long to call a stack tool; after that each tool call or snapshot extends it.
export const GRANT_LEASE_MS = 10 * 60_000;
export const HOLD_LEASE_MS = 30 * 60_000;
export const DAEMON_STALE_MS = 90_000;
export const WAITER_FORGET_MS = 60 * 60_000;
const EVENT_CAP = 50;

const entrySchema = z.object({
  daemon: z.string(),
  agentId: z.string(),
  agentTitle: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string(),
  workspaceDir: z.string(),
  branch: z.string().nullable(),
  joinedAt: z.string(),
  lastSeenAt: z.string(),
});
export type Entry = z.infer<typeof entrySchema>;

const holderSchema = entrySchema.extend({
  grantedAt: z.string(),
  leaseUntil: z.string(),
  snapshot: z.object({ commit: z.string(), tree: z.string(), at: z.string() }).nullable(),
});
export type Holder = z.infer<typeof holderSchema>;

const eventSchema = z.object({ at: z.string(), text: z.string() });
export type QueueEvent = z.infer<typeof eventSchema>;

export const queueStateSchema = z.object({
  holder: holderSchema.nullable(),
  waiting: z.array(entrySchema),
  daemons: z.record(z.string(), z.string()),
  events: z.array(eventSchema),
});
export type QueueState = z.infer<typeof queueStateSchema>;

export const emptyState = (): QueueState => ({ holder: null, waiting: [], daemons: {}, events: [] });

export type Caller = Omit<Entry, "joinedAt" | "lastSeenAt">;

const iso = (ms: number) => new Date(ms).toISOString();
const age = (since: string, now: number) => now - Date.parse(since);
export const sameAgent = (a: { daemon: string; agentId: string }, b: { daemon: string; agentId: string }) =>
  a.daemon === b.daemon && a.agentId === b.agentId;
export const describeEntry = (entry: Pick<Entry, "daemon" | "agentId" | "agentTitle" | "workspaceName">) =>
  `${entry.agentTitle ? `"${entry.agentTitle}"` : entry.agentId} (${entry.workspaceName}, ${entry.daemon})`;

function log(state: QueueState, now: number, text: string): QueueState {
  return { ...state, events: [...state.events, { at: iso(now), text }].slice(-EVENT_CAP) };
}

// Every daemon runs this on every tick: heartbeat, drop the stale, hand the stack to the first waiter.
export function tick(state: QueueState, daemon: string, now: number): QueueState {
  let next: QueueState = { ...state, daemons: { ...state.daemons, [daemon]: iso(now) } };
  const daemonGone = (entry: Entry) => {
    const beat = next.daemons[entry.daemon];
    return !beat || age(beat, now) > DAEMON_STALE_MS;
  };
  const holder = next.holder;
  if (holder) {
    const reason = daemonGone(holder)
      ? `its daemon (${holder.daemon}) stopped answering`
      : Date.parse(holder.leaseUntil) < now
        ? "its lease ran out"
        : null;
    if (reason) next = log({ ...next, holder: null }, now, `${describeEntry(holder)} lost the stack: ${reason}`);
  }
  const kept = next.waiting.filter((entry) => !daemonGone(entry) && age(entry.lastSeenAt, now) <= WAITER_FORGET_MS);
  for (const entry of next.waiting) {
    if (!kept.includes(entry)) next = log(next, now, `${describeEntry(entry)} left the queue: it stopped asking`);
  }
  next = { ...next, waiting: kept };
  return promote(next, now);
}

function promote(state: QueueState, now: number): QueueState {
  if (state.holder || state.waiting.length === 0) return state;
  const [first, ...rest] = state.waiting;
  const holder: Holder = { ...first, grantedAt: iso(now), leaseUntil: iso(now + GRANT_LEASE_MS), snapshot: null };
  return log({ ...state, holder, waiting: rest }, now, `${describeEntry(first)} got the stack`);
}

// Joining twice keeps the caller's place; a call from the holder renews its lease.
export function join(state: QueueState, caller: Caller, now: number): QueueState {
  if (state.holder && sameAgent(state.holder, caller)) {
    return { ...state, holder: { ...state.holder, ...caller, lastSeenAt: iso(now), leaseUntil: iso(now + HOLD_LEASE_MS) } };
  }
  const existing = state.waiting.find((entry) => sameAgent(entry, caller));
  if (existing) {
    return { ...state, waiting: state.waiting.map((entry) => (entry === existing ? { ...entry, ...caller, lastSeenAt: iso(now) } : entry)) };
  }
  const entry: Entry = { ...caller, joinedAt: iso(now), lastSeenAt: iso(now) };
  return promote(log({ ...state, waiting: [...state.waiting, entry] }, now, `${describeEntry(entry)} joined the queue`), now);
}

export function renew(state: QueueState, who: { daemon: string; agentId: string }, now: number): QueueState {
  if (state.holder && sameAgent(state.holder, who)) {
    return { ...state, holder: { ...state.holder, lastSeenAt: iso(now), leaseUntil: iso(now + HOLD_LEASE_MS) } };
  }
  return { ...state, waiting: state.waiting.map((entry) => (sameAgent(entry, who) ? { ...entry, lastSeenAt: iso(now) } : entry)) };
}

export function leave(state: QueueState, who: { daemon: string; agentId: string }, now: number, reason: string): QueueState {
  let next = state;
  if (state.holder && sameAgent(state.holder, who)) {
    next = log({ ...next, holder: null }, now, `${describeEntry(state.holder)} released the stack: ${reason}`);
  }
  const leaving = next.waiting.find((entry) => sameAgent(entry, who));
  if (leaving) {
    next = log({ ...next, waiting: next.waiting.filter((entry) => entry !== leaving) }, now, `${describeEntry(leaving)} left the queue: ${reason}`);
  }
  return promote(next, now);
}

export function recordSnapshot(state: QueueState, who: { daemon: string; agentId: string }, snapshot: { commit: string; tree: string }, now: number): QueueState {
  if (!state.holder || !sameAgent(state.holder, who)) return state;
  return {
    ...state,
    holder: { ...state.holder, snapshot: { ...snapshot, at: iso(now) }, leaseUntil: iso(Math.max(Date.parse(state.holder.leaseUntil), now + HOLD_LEASE_MS)) },
  };
}

// 0 for the holder, 1 for the first waiter, null when not queued.
export function placeOf(state: QueueState, who: { daemon: string; agentId: string }): number | null {
  if (state.holder && sameAgent(state.holder, who)) return 0;
  const index = state.waiting.findIndex((entry) => sameAgent(entry, who));
  return index === -1 ? null : index + 1;
}
