import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import type { MessageQueue, QueuedMessage } from "./message-queue.server";
import type { PaseoCli, PaseoCliOptions } from "./paseo-cli.server";
import type { Watch, WatchList } from "./watch-list.server";

const BUSY_STATUSES = new Set(["running", "initializing"]);
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_WAITING_PER_AGENT = 20;
const inspectedAgentSchema = z.object({
  Id: z.string(),
  Status: z.string(),
  UpdatedAt: z.string(),
  Archived: z.boolean().default(false),
});
const PERMANENT_FAILURE = /agent not found|no agent found|ambiguous|is archived/i;
// The CLI stopped by the plugin's own timeout: the daemon may already have taken the message.
const CUT_OFF = /^paseo timed out/;

// Null means this daemon: a notice to the agent that sent a message.
type Daemon = Peer | null;

// Keeps pairing links out of anything an agent or a log sees.
export function describeError(error: unknown, daemon: Daemon): string {
  const reason = error instanceof Error ? error.message : String(error);
  return daemon ? reason.replaceAll(daemon.link, `<link to ${daemon.name}>`) : reason;
}

export class MaybeDeliveredError extends Error {}

export interface SendRequest {
  peer: Peer;
  agentRef: string;
  text: string;
  callerAgentId: string | null;
  notifyOnFinish: boolean;
}

export type SendOutcome = { kind: "sent" | "queued" | "queued-behind"; agentId: string };

interface MessengerDependencies {
  queue: MessageQueue;
  watches: WatchList;
  readPeers(): Peer[];
  cli: PaseoCli;
  now?: () => number;
}

function runOn(cli: PaseoCli, daemon: Daemon, args: readonly string[], options?: PaseoCliOptions) {
  return daemon ? cli.run(daemon.link, args, options) : cli.runLocal(args, options);
}

function composeFinishNotice(peer: Peer, agentId: string, lastMessage: string): string {
  const marker = randomBytes(4).toString("hex");
  return [
    `[cross-daemon notice ${marker}] Agent ${agentId} on daemon "${peer.name}" (${peer.serverId}) finished the task you sent it. ` +
      `Its last message is between the two ${marker} lines.`,
    `----- ${marker} begin -----`,
    lastMessage || "(none)",
    `----- ${marker} end -----`,
  ].join("\n");
}

export function createMessenger({ queue, watches, readPeers, cli, now = Date.now }: MessengerDependencies) {
  const agentLocks = new Map<string, Promise<unknown>>();

  // One check-then-send at a time per agent, shared by the tool and the delivery rounds, so two
  // messages can never both find an agent idle and the second interrupt the first.
  async function withAgentLock<T>(daemon: Daemon, agentId: string, action: () => Promise<T>): Promise<T> {
    const key = `${daemon?.serverId ?? "local"}/${agentId}`;
    const previous = agentLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(action);
    agentLocks.set(key, run);
    try {
      return await run;
    } finally {
      if (agentLocks.get(key) === run) agentLocks.delete(key);
    }
  }

  async function inspect(daemon: Daemon, agentRef: string) {
    const inspected = inspectedAgentSchema.parse(JSON.parse(await runOn(cli, daemon, ["inspect", agentRef, "--json"])));
    if (inspected.Archived) throw new Error(`Agent ${inspected.Id} is archived`);
    return { id: inspected.Id, busy: BUSY_STATUSES.has(inspected.Status), updatedAt: inspected.UpdatedAt };
  }

  async function deliver(daemon: Daemon, agentId: string, text: string): Promise<void> {
    try {
      await runOn(cli, daemon, ["send", agentId, "--no-wait"], { promptText: text });
    } catch (error) {
      if (CUT_OFF.test(describeError(error, daemon))) {
        throw new MaybeDeliveredError(`The send timed out, so the message may have been delivered to agent ${agentId}.`);
      }
      throw error;
    }
  }

  function tellSender(callerAgentId: string | null, text: string): void {
    if (callerAgentId) queue.add({ peerServerId: null, agentId: callerAgentId, text, callerAgentId: null }, new Date(now()));
  }

  function watchIfAsked(peer: Peer, agentId: string, callerAgentId: string | null, notify: boolean, updatedAt: string) {
    if (notify && callerAgentId) {
      watches.add({ peerServerId: peer.serverId, agentId, callerAgentId, updatedAtBeforeSend: updatedAt }, new Date(now()));
    }
  }

  async function send(request: SendRequest): Promise<SendOutcome> {
    const { peer, text, callerAgentId, notifyOnFinish } = request;
    // Outside the lock this only resolves a prefix to the full ID: the reading may be stale by the
    // time the lock is held, so the agent is read again inside it.
    const { id: agentId } = await inspect(peer, request.agentRef);
    return withAgentLock(peer, agentId, async () => {
      const waiting = queue.countPendingFor(peer.serverId, agentId);
      if (waiting >= MAX_WAITING_PER_AGENT) {
        throw new Error(`${MAX_WAITING_PER_AGENT} messages are already waiting for agent ${agentId}. Try again once it has read them.`);
      }
      const queueIt = () => queue.add({ peerServerId: peer.serverId, agentId, text, callerAgentId, notifyOnFinish }, new Date(now()));
      if (waiting > 0) {
        queueIt();
        return { kind: "queued-behind", agentId };
      }
      const state = await inspect(peer, agentId);
      if (state.busy) {
        queueIt();
        return { kind: "queued", agentId };
      }
      await deliver(peer, agentId, text);
      watchIfAsked(peer, agentId, callerAgentId, notifyOnFinish, state.updatedAt);
      return { kind: "sent", agentId };
    });
  }

  function dropMessage(message: QueuedMessage, where: string, reason: string): void {
    console.warn(`cross-daemon: dropped a message to agent ${message.agentId} on ${where}: ${reason}`);
    queue.remove(message.id);
    tellSender(message.callerAgentId, `[cross-daemon notice] Your message to agent ${message.agentId} on ${where} was not delivered: ${reason}`);
  }

  async function deliverQueued(message: QueuedMessage): Promise<void> {
    const daemon = message.peerServerId === null ? null : readPeers().find((peer) => peer.serverId === message.peerServerId);
    const where = daemon === null ? "this daemon" : (daemon?.name ?? message.peerServerId ?? "?");
    if (message.inFlight) {
      dropMessage(message, where, "its send was cut off by a restart, so it may have been delivered. Check before sending again.");
      return;
    }
    if (now() - Date.parse(message.queuedAt) > MAX_MESSAGE_AGE_MS) {
      dropMessage(message, where, "it waited more than 24 hours for the agent to become idle.");
      return;
    }
    // A daemon that is switched off, or not synced yet, keeps its messages until they expire.
    if (daemon === undefined) return;
    await withAgentLock(daemon, message.agentId, async () => {
      try {
        const before = await inspect(daemon, message.agentId);
        if (before.busy) return;
        queue.setInFlight(message.id, true);
        await deliver(daemon, message.agentId, message.text);
        queue.remove(message.id);
        if (daemon) watchIfAsked(daemon, message.agentId, message.callerAgentId, message.notifyOnFinish, before.updatedAt);
      } catch (error) {
        const reason = describeError(error, daemon);
        if (error instanceof MaybeDeliveredError || PERMANENT_FAILURE.test(reason)) {
          dropMessage(message, where, reason);
          return;
        }
        console.warn(`cross-daemon: will retry a message to agent ${message.agentId} on ${where}: ${reason}`);
        queue.setInFlight(message.id, false);
      }
    });
  }

  async function checkWatch(watch: Watch): Promise<void> {
    if (now() - Date.parse(watch.watchedAt) > MAX_MESSAGE_AGE_MS) {
      watches.remove(watch.id);
      tellSender(watch.callerAgentId, `[cross-daemon notice] Gave up after 24 hours: did not see agent ${watch.agentId} finish.`);
      return;
    }
    const peer = readPeers().find((candidate) => candidate.serverId === watch.peerServerId);
    if (!peer) return;
    try {
      const state = await inspect(peer, watch.agentId);
      if (state.busy) {
        if (!watch.sawBusy) watches.markBusy(watch.id);
        return;
      }
      if (!watch.sawBusy && state.updatedAt === watch.updatedAtBeforeSend) return;
      const lastMessage = await cli.run(peer.link, ["logs", watch.agentId, "--filter", "text", "--tail", "1"]);
      tellSender(watch.callerAgentId, composeFinishNotice(peer, watch.agentId, lastMessage));
      watches.remove(watch.id);
    } catch (error) {
      const reason = describeError(error, peer);
      console.warn(`cross-daemon: could not check agent ${watch.agentId} on ${peer.name}: ${reason}`);
      if (PERMANENT_FAILURE.test(reason)) watches.remove(watch.id);
    }
  }

  // Watches first, so a finish notice can go out in the same round. Only the oldest message per
  // agent is tried: once it is delivered the agent is busy, and the next one waits.
  async function runRound(): Promise<void> {
    try {
      await Promise.allSettled(watches.list().map(checkWatch));
      const oldestPerAgent = new Map<string, QueuedMessage>();
      for (const message of queue.list()) {
        const key = `${message.peerServerId ?? "local"}/${message.agentId}`;
        if (!oldestPerAgent.has(key)) oldestPerAgent.set(key, message);
      }
      await Promise.allSettled([...oldestPerAgent.values()].map(deliverQueued));
    } catch (error) {
      console.error("cross-daemon: a delivery round failed", error);
    }
  }

  return { send, runRound };
}
export type Messenger = ReturnType<typeof createMessenger>;

export function startDeliveryWorker(messenger: Messenger, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    messenger.runRound().finally(() => {
      running = false;
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
