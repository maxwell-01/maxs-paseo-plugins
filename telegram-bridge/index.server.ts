import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { startBridge } from "./server/bridge.server";
import { bridgeDataDir } from "./server/data-dir.server";
import { TELEGRAM_API_URL } from "./server/telegram-api.server";
import { bridgeSettings } from "./shared/settings.shared";

type PaseoApi = PluginHookContext["paseo"];

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(bridgeSettings);
  let remember!: (paseo: PaseoApi) => void;
  const paseo = new Promise<PaseoApi>((resolve) => {
    remember = resolve;
  });
  const stopListening = server.on("agent.turn_started", (_event, context) => {
    remember(context.paseo);
    stopListening();
  });

  const log = (line: string) => console.log(line);
  return startBridge({ settings, paseo, dataDir: bridgeDataDir(), apiUrl: process.env.TELEGRAM_BRIDGE_API_URL ?? TELEGRAM_API_URL, log });
}
