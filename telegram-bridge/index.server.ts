import type { PluginServerContext } from "@getpaseo/plugin/server";
import { bridgeSettings } from "./shared/settings.shared";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(bridgeSettings);
  return () => {};
}
