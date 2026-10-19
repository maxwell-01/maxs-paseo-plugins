import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BridgeSettingsScreen } from "./client/settings-screen.client";

export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({ id: "bridge", title: "Telegram bridge", icon: "Send", Component: BridgeSettingsScreen });
}
