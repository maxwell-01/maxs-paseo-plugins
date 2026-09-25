import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createDaemonPort } from "./client/notes-sync.client";
import { registerDaemon } from "./client/sync-scheduler.client";

export default function contribute(client: PluginClientContext) {
  return registerDaemon(createDaemonPort(client.rpc));
}
