import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import type { MessageQueue, QueuedMessage } from "./message-queue.server";
import type { PaseoCli } from "./paseo-cli.server";

const BUSY_STATUSES = new Set(["running", "initializing"]);
const inspectedAgentSchema = z.object({ Status: z.string() });

export async function isAgentBusy(cli: PaseoCli, link: string, agentId: string): Promise<boolean> {
  const inspected = inspectedAgentSchema.parse(JSON.parse(await cli.run(link, ["inspect", agentId, "--json"])));
  return BUSY_STATUSES.has(inspected.Status);
}

export async function sendPrompt(cli: PaseoCli, link: string, agentId: string, text: string): Promise<void> {
  await cli.run(link, ["send", agentId, "--no-wait"], { promptText: text });
}

interface DeliveryDependencies {
  queue: MessageQueue;
  readPeers(): Peer[];
  cli: PaseoCli;
}

async function deliverOne({ queue, readPeers, cli }: DeliveryDependencies, message: QueuedMessage): Promise<void> {
  const peer = readPeers().find((candidate) => candidate.serverId === message.peerServerId);
  if (!peer) {
    console.warn(`cross-daemon: dropped a message to agent ${message.agentId}; daemon ${message.peerServerId} is no longer reachable`);
    queue.remove(message.id);
    return;
  }
  try {
    if (await isAgentBusy(cli, peer.link, message.agentId)) return;
    await sendPrompt(cli, peer.link, message.agentId, message.text);
    queue.remove(message.id);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replaceAll(peer.link, `<link to ${peer.name}>`);
    if (/agent not found|no agent found/i.test(reason)) {
      console.warn(`cross-daemon: dropped a message to agent ${message.agentId} on ${peer.name}: ${reason}`);
      queue.remove(message.id);
    } else {
      console.warn(`cross-daemon: will retry a message to agent ${message.agentId} on ${peer.name}: ${reason}`);
    }
  }
}

// The oldest message per agent only: once it is delivered the agent is busy, and the next one waits.
export async function deliverQueuedMessages(deps: DeliveryDependencies): Promise<void> {
  const oldestPerAgent = new Map<string, QueuedMessage>();
  for (const message of deps.queue.list()) {
    const key = `${message.peerServerId}/${message.agentId}`;
    if (!oldestPerAgent.has(key)) oldestPerAgent.set(key, message);
  }
  await Promise.all([...oldestPerAgent.values()].map((message) => deliverOne(deps, message)));
}

export function startDeliveryWorker(deps: DeliveryDependencies, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    deliverQueuedMessages(deps).finally(() => {
      running = false;
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
