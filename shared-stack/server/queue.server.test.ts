import { describe, expect, it } from "vitest";
import { type Caller, type QueueState, DAEMON_STALE_MS, emptyState, GRANT_LEASE_MS, HOLD_LEASE_MS, join, leave, placeOf, recordSnapshot, renew, tick, WAITER_FORGET_MS } from "./queue.server";

const agent = (daemon: string, agentId: string): Caller => ({
  daemon,
  agentId,
  agentTitle: `agent ${agentId}`,
  workspaceId: `ws-${agentId}`,
  workspaceName: `workspace ${agentId}`,
  workspaceDir: `/work/${agentId}`,
  branch: `branch-${agentId}`,
});
const a = agent("alice", "a");
const b = agent("bob", "b");
const c = agent("carol", "c");
const T = Date.parse("2026-10-30T12:00:00.000Z");

const withDaemons = (now: number) => ["alice", "bob", "carol"].reduce((state, daemon) => tick(state, daemon, now), emptyState());
// Every daemon heartbeats on its own; this stands in for them all having done so at `now`.
const allAlive = (state: QueueState, now: number): QueueState => ({ ...state, daemons: { alice: iso(now), bob: iso(now), carol: iso(now) } });
const iso = (ms: number) => new Date(ms).toISOString();

describe("queue", () => {
  it("gives the stack to the first agent to join and queues the rest in order", () => {
    let state = withDaemons(T);
    state = join(state, a, T);
    state = join(state, b, T + 1);
    state = join(state, c, T + 2);
    expect(state.holder?.agentId).toBe("a");
    expect(state.holder?.leaseUntil).toBe(new Date(T + GRANT_LEASE_MS).toISOString());
    expect(state.waiting.map((entry) => entry.agentId)).toEqual(["b", "c"]);
    expect([placeOf(state, a), placeOf(state, b), placeOf(state, c)]).toEqual([0, 1, 2]);
  });

  it("keeps an agent's place when it joins again", () => {
    let state = join(join(join(withDaemons(T), a, T), b, T), c, T);
    state = join(state, b, T + 1000);
    expect(state.waiting.map((entry) => entry.agentId)).toEqual(["b", "c"]);
    expect(state.waiting[0].lastSeenAt).toBe(new Date(T + 1000).toISOString());
  });

  it("hands the stack to the next agent on release", () => {
    let state = join(join(withDaemons(T), a, T), b, T);
    state = leave(state, a, T + 5, "done");
    expect(state.holder?.agentId).toBe("b");
    expect(state.waiting).toEqual([]);
    expect(state.events.at(-1)?.text).toContain("got the stack");
  });

  it("times out a holder whose lease ran out", () => {
    let state = join(join(withDaemons(T), a, T), b, T);
    const later = T + GRANT_LEASE_MS + 1;
    state = tick(allAlive(state, later), "alice", later);
    expect(state.holder?.agentId).toBe("b");
    expect(state.events.some((event) => event.text.includes("lease ran out"))).toBe(true);
  });

  it("extends the lease on renew and on a new snapshot", () => {
    let state = join(withDaemons(T), a, T);
    state = renew(state, a, T + 1000);
    expect(state.holder?.leaseUntil).toBe(new Date(T + 1000 + HOLD_LEASE_MS).toISOString());
    state = recordSnapshot(state, a, { commit: "c1", tree: "t1" }, T + 2000);
    expect(state.holder?.snapshot?.commit).toBe("c1");
    expect(state.holder?.leaseUntil).toBe(new Date(T + 2000 + HOLD_LEASE_MS).toISOString());
  });

  it("ignores a snapshot from an agent that no longer holds the stack", () => {
    let state = join(join(withDaemons(T), a, T), b, T);
    state = leave(state, a, T, "done");
    expect(recordSnapshot(state, a, { commit: "c1", tree: "t1" }, T)).toBe(state);
  });

  it("drops the entries of a daemon that stopped heartbeating", () => {
    let state = join(join(join(withDaemons(T), a, T), b, T), c, T);
    const later = T + DAEMON_STALE_MS + 1;
    state = tick(tick(state, "bob", later), "carol", later);
    expect(state.holder?.agentId).toBe("b");
    expect(state.events.some((event) => event.text.includes("alice") && event.text.includes("stopped answering"))).toBe(true);
  });

  it("forgets a waiter that stopped asking", () => {
    let state = join(join(withDaemons(T), a, T), b, T);
    state = renew(state, a, T + WAITER_FORGET_MS);
    const later = T + WAITER_FORGET_MS + 1;
    state = tick(allAlive(state, later), "alice", later);
    expect(state.holder?.agentId).toBe("a");
    expect(state.waiting).toEqual([]);
  });

  it("tells agents on different daemons with the same agent id apart", () => {
    const bobA = agent("bob", "a");
    let state = join(join(withDaemons(T), a, T), bobA, T);
    expect(placeOf(state, bobA)).toBe(1);
    state = leave(state, bobA, T, "done");
    expect(state.holder?.daemon).toBe("alice");
    expect(state.waiting).toEqual([]);
  });
});
