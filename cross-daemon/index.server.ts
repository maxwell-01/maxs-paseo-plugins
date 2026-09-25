import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { paseoHome, readOwnDaemon, readOwnServerId } from "./server/own-daemon.server";
import { describeOwnDaemon, peersToStore } from "./server/peer-policy.server";
import { createPeerStore } from "./server/peer-store.server";
import { crossDaemonSettings, describeDaemon, setPeers } from "./shared/cross-daemon.shared";

type CrossDaemonSettingsState = PluginSettingsState<typeof crossDaemonSettings.schema>;

function isEnabled(state: CrossDaemonSettingsState): boolean {
  return state.status === "ready" && state.values.enabled;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(crossDaemonSettings);
  const peers = createPeerStore(join(paseoHome(), "plugin-data", "cross-daemon"));

  server.handle(describeDaemon, async (_input, { paseo }) => {
    const { config } = await paseo.config.get();
    const own = await readOwnDaemon(config.relay?.enabled);
    return describeOwnDaemon(own, isEnabled(await settings.read()));
  });

  server.handle(setPeers, async (input) => {
    const stored = peersToStore({
      enabled: isEnabled(await settings.read()),
      ownServerId: await readOwnServerId(),
      peers: input.peers,
    });
    peers.write(stored);
    return { stored: stored.length };
  });

  return settings.subscribe((state) => {
    if (!isEnabled(state)) peers.write([]);
  });
}
