import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

const watchSchema = z.object({
  id: z.string(),
  peerServerId: z.string(),
  agentId: z.string(),
  callerAgentId: z.string(),
  // The agent's UpdatedAt just before the message went in; a later value means its turn ran.
  updatedAtBeforeSend: z.string(),
  sawBusy: z.boolean(),
  watchedAt: z.string(),
});
export type Watch = z.infer<typeof watchSchema>;

// Agents on other daemons whose sender asked to be told when they finish.
export function createWatchList(stateDir: string) {
  const watchFile = join(stateDir, "watches.json");
  const list = (): Watch[] => readPrivateJson(watchFile, z.array(watchSchema), []);
  return {
    list,
    add(watch: Omit<Watch, "id" | "sawBusy" | "watchedAt">, watchedAt: Date): void {
      writePrivateJson(watchFile, [...list(), { ...watch, id: randomUUID(), sawBusy: false, watchedAt: watchedAt.toISOString() }]);
    },
    markBusy(id: string): void {
      writePrivateJson(watchFile, list().map((watch) => (watch.id === id ? { ...watch, sawBusy: true } : watch)));
    },
    remove(id: string): void {
      writePrivateJson(watchFile, list().filter((watch) => watch.id !== id));
    },
  };
}
export type WatchList = ReturnType<typeof createWatchList>;
