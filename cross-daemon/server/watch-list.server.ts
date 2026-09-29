import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

const watchSchema = z.object({
  id: z.string(),
  peerServerId: z.string(),
  agentId: z.string(),
  callerAgentId: z.string(),
  // The agent's UpdatedAt just before the message went in; a later value means its turn ran. Null for
  // an agent that create_agent started, which is watched only once it has been seen busy.
  updatedAtBeforeSend: z.string().nullable(),
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
    add(watch: Omit<Watch, "id" | "sawBusy" | "watchedAt"> & { sawBusy?: boolean }, watchedAt: Date): void {
      writePrivateJson(watchFile, [...list(), { sawBusy: false, ...watch, id: randomUUID(), watchedAt: watchedAt.toISOString() }]);
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
