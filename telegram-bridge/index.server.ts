import { homedir } from "node:os";
import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { startBridge } from "./server/bridge.server";
import { bridgeDataDir, paseoHome } from "./server/data-dir.server";
import { TELEGRAM_API_URL } from "./server/telegram-api.server";
import { callOwnRpc, wakeSelf } from "./server/wake.server";
import { bridgeSettings } from "./shared/settings.shared";
import { wakeBridge } from "./shared/wake.shared";

type PaseoApi = PluginHookContext["paseo"];

const PLUGIN_ID = "telegram-bridge";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(bridgeSettings);
  let isAwake = false;
  let resolvePaseo!: (paseo: PaseoApi) => void;
  const paseo = new Promise<PaseoApi>((resolve) => {
    resolvePaseo = resolve;
  });
  const remember = (handle: PaseoApi) => {
    isAwake = true;
    resolvePaseo(handle);
  };
  server.handle(wakeBridge, (_input, context) => {
    remember(context.paseo);
    return {};
  });
  const stopListening = server.on("agent.turn_started", (_event, context) => {
    remember(context.paseo);
    stopListening();
  });

  const log = (line: string) => console.log(line);
  const stopping = new AbortController();
  void wakeSelf({
    callOwnRpc: (signal) => callOwnRpc(paseoHome(), PLUGIN_ID, wakeBridge.name, signal),
    isAwake: () => isAwake,
    signal: stopping.signal,
    log,
  });
  const bridge = startBridge({
    settings,
    paseo,
    dataDir: bridgeDataDir(),
    home: homedir(),
    paseoHome: paseoHome(),
    apiUrl: process.env.TELEGRAM_BRIDGE_API_URL ?? TELEGRAM_API_URL,
    log,
  });
  // Posting runs past the hook's 30-second limit when a reply has many parts, so the hook does not wait for it.
  server.on("agent.turn_ended", (event) => void bridge.onTurnEnded(event));
  return async () => {
    stopping.abort();
    await bridge.stop();
  };
}
