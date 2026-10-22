import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createDaemonPort } from "./client/peer-sync.client";
import { CrossDaemonSettingsScreen } from "./client/settings-screen.client";
import { registerDaemon } from "./client/sync-scheduler.client";

export default function contribute(client: PluginClientContext) {
  const unregisterDaemon = registerDaemon(createDaemonPort(client.rpc));
  const removeSettingsScreen = client.addSettingsScreen({
    id: "cross-daemon",
    title: "Settings",
    icon: "Network",
    Component: CrossDaemonSettingsScreen,
  });
  return () => {
    unregisterDaemon();
    removeSettingsScreen();
  };
}
