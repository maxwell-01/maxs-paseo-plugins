import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CrossDaemonRow } from "./client/cross-daemon-row.client";
import { createDaemonPort } from "./client/peer-sync.client";
import { CrossDaemonSettingsScreen } from "./client/settings-screen.client";
import { registerDaemon } from "./client/sync-scheduler.client";
import { CROSS_DAEMON_ROW_KIND, crossDaemonRowSchema, transformUserMessage } from "./client/timeline-rows.client";

export default function contribute(client: PluginClientContext) {
  const unregisterDaemon = registerDaemon(createDaemonPort(client.rpc));
  const removeSettingsScreen = client.addSettingsScreen({
    id: "cross-daemon",
    title: "Settings",
    icon: "Network",
    Component: CrossDaemonSettingsScreen,
  });
  const removeReceivedRows = client.addTimelineTransformer({
    id: "cross-daemon-received",
    query: { itemType: "user_message" },
    transform: transformUserMessage,
  });
  const removeRowRenderer = client.addTimelineRenderer({
    kind: CROSS_DAEMON_ROW_KIND,
    version: 1,
    schema: crossDaemonRowSchema,
    Component: CrossDaemonRow,
  });
  return () => {
    unregisterDaemon();
    removeSettingsScreen();
    removeReceivedRows();
    removeRowRenderer();
  };
}
