import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PacingSettingsScreen } from "./client/settings-screen.client";

export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({ id: "pacing", title: "Usage pacing", icon: "Gauge", Component: PacingSettingsScreen });
}
