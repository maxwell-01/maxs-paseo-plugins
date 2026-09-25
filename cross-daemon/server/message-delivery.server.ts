import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import type { MessageQueue, QueuedMessage } from "./message-queue.server";
import type { PaseoCli, PaseoCliOptions } from "./paseo-cli.server";
import type { Watch, WatchList } from "./watch-list.server";

const BUSY_STATUSES = new Set(["running", "initializing"]);
const inspectedAgentSchema = z.object({ Status: z.string(), UpdatedAt: z.string() });
const AGENT_GONE = /agent not found|no agent found/i;

// Null means an agent on this daemon.
type Daemon = Peer | null;

function runOn(cli: PaseoCli, daemon: Daemon, args: readonly string[], options?: PaseoCliOptions) {
  return daemon ? cli.run(daemon.link, args, options) : cli.runLocal(args, options);
}

export async function readAgentState(cli: PaseoCli, daemon: Daemon, agentId: string) {
  const inspected = inspectedAgentSchema.parse(JSON.parse(await runOn(cli, daemon, ["inspect", agentId, "--json"])));
  return { busy: BUSY_STATUSES.has(inspected.Status), updatedAt: inspected.UpdatedAt };
}

export async function sendPrompt(cli: PaseoCli, daemon: Daemon, agentId: string, text: string): Promise<void> {
  await runOn(cli, daemon, ["send", agentId, "--no-wait"], { promptText: text });
}

interface DeliveryDependencies {
  queue: MessageQueue;
  watches: WatchList;
  readPeers(): Peer[];
  cli: PaseoCli;
}

function describeError(error: unknown, daemon: Daemon): string {
  const reason = error instanceof Error ? error.message : String(error);
  return daemon ? reason.replaceAll(daemon.link, `<link to ${daemon.name}>`) : reason;
}

async function deliverOne({ queue, watches, readPeers, cli }: DeliveryDependencies, message: QueuedMessage): Promise<void> {
  const daemon = message.peerServerId === null ? null : readPeers().find((peer) => peer.serverId === message.peerServerId);
  const where = daemon === null ? "this daemon" : daemon?.name;
  if (daemon === undefined) {
    console.warn(`cross-daemon: dropped a message to agent ${message.agentId}; daemon ${message.peerServerId} is no longer reachable`);
    queue.remove(message.id);
    return;
  }
  try {
    const before = await readAgentState(cli, daemon, message.agentId);
    if (before.busy) return;
    await sendPrompt(cli, daemon, message.agentId, message.text);
    queue.remove(message.id);
    if (daemon && message.notifyOnFinish && message.callerAgentId) {
      watches.add({
        peerServerId: daemon.serverId,
        agentId: message.agentId,
        callerAgentId: message.callerAgentId,
        updatedAtBeforeSend: before.updatedAt,
      });
    }
  } catch (error) {
    const reason = describeError(error, daemon);
    if (AGENT_GONE.test(reason)) {
      console.warn(`cross-daemon: dropped a message to agent ${message.agentId} on ${where}: ${reason}`);
      queue.remove(message.id);
    } else {
      console.warn(`cross-daemon: will retry a message to agent ${message.agentId} on ${where}: ${reason}`);
    }
  }
}

function composeFinishNotice(peer: Peer, agentId: string, lastMessage: string): string {
  return [
    `[cross-daemon notice] Agent ${agentId} on daemon "${peer.name}" (${peer.serverId}) finished the task you sent it.`,
    "",
    "Its last message:",
    lastMessage || "(none)",
  ].join("\n");
}

async function checkWatch({ queue, watches, readPeers, cli }: DeliveryDependencies, watch: Watch): Promise<void> {
  const peer = readPeers().find((candidate) => candidate.serverId === watch.peerServerId);
  if (!peer) {
    watches.remove(watch.id);
    return;
  }
  try {
    const state = await readAgentState(cli, peer, watch.agentId);
    if (state.busy) {
      if (!watch.sawBusy) watches.markBusy(watch.id);
      return;
    }
    const turnRan = watch.sawBusy || state.updatedAt !== watch.updatedAtBeforeSend;
    if (!turnRan) return;
    const lastMessage = await cli.run(peer.link, ["logs", watch.agentId, "--filter", "text", "--tail", "1"]);
    queue.add({ peerServerId: null, agentId: watch.callerAgentId, text: composeFinishNotice(peer, watch.agentId, lastMessage), callerAgentId: null });
    watches.remove(watch.id);
  } catch (error) {
    const reason = describeError(error, peer);
    console.warn(`cross-daemon: could not check agent ${watch.agentId} on ${peer.name}: ${reason}`);
    if (AGENT_GONE.test(reason)) watches.remove(watch.id);
  }
}

// Watches first, so a finish notice can go out in the same round. Only the oldest message per agent
// is tried: once it is delivered the agent is busy, and the next one waits.
export async function runDeliveryRound(deps: DeliveryDependencies): Promise<void> {
  await Promise.all(deps.watches.list().map((watch) => checkWatch(deps, watch)));
  const oldestPerAgent = new Map<string, QueuedMessage>();
  for (const message of deps.queue.list()) {
    const key = `${message.peerServerId ?? "local"}/${message.agentId}`;
    if (!oldestPerAgent.has(key)) oldestPerAgent.set(key, message);
  }
  await Promise.all([...oldestPerAgent.values()].map((message) => deliverOne(deps, message)));
}

export function startDeliveryWorker(deps: DeliveryDependencies, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDeliveryRound(deps).finally(() => {
      running = false;
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
