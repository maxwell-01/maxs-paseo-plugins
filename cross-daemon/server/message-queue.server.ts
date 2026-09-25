import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

const queuedMessageSchema = z.object({
  id: z.string(),
  // Null for an agent on this daemon: a finish notice to the agent that sent a message.
  peerServerId: z.string().nullable(),
  agentId: z.string(),
  text: z.string(),
  callerAgentId: z.string().nullable(),
  notifyOnFinish: z.boolean().default(false),
  queuedAt: z.string(),
});
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;

export function createMessageQueue(stateDir: string) {
  const queueFile = join(stateDir, "queue.json");
  const list = (): QueuedMessage[] => readPrivateJson(queueFile, z.array(queuedMessageSchema), []);
  return {
    list,
    add(message: Omit<QueuedMessage, "id" | "queuedAt" | "notifyOnFinish"> & { notifyOnFinish?: boolean }): void {
      const queued = { notifyOnFinish: false, ...message, id: randomUUID(), queuedAt: new Date().toISOString() };
      writePrivateJson(queueFile, [...list(), queued]);
    },
    remove(id: string): void {
      writePrivateJson(queueFile, list().filter((message) => message.id !== id));
    },
    hasPendingFor(peerServerId: string | null, agentId: string): boolean {
      return list().some((message) => message.peerServerId === peerServerId && message.agentId === agentId);
    },
  };
}
export type MessageQueue = ReturnType<typeof createMessageQueue>;
