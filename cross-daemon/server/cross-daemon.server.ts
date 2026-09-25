import type { PluginServerContext } from "@getpaseo/plugin/server";
import { crossDaemonSettings, describeDaemon, type Peer, setPeers } from "../shared/cross-daemon.shared";
import type { createPeerStore } from "./peer-store.server";
import { isSwitchedOn, peersToStore } from "./switch-policy.server";

interface CrossDaemonDependencies {
  readOwnPeer(relayEnabled: boolean): Promise<Peer | null>;
  peerStore: Promise<ReturnType<typeof createPeerStore>>;
}

export function registerCrossDaemon(server: PluginServerContext, { readOwnPeer, peerStore }: CrossDaemonDependencies) {
  const settings = server.registerSettings(crossDaemonSettings);
  const clearPeersUnlessSwitchedOn = async () => {
    const store = await peerStore;
    if (!isSwitchedOn(await settings.read())) store.write([]);
  };

  server.handle(describeDaemon, async (_input, { paseo }) => {
    const { config } = await paseo.config.get();
    const own = await readOwnPeer(config.relay?.enabled === true);
    return { serverId: own?.serverId ?? null, member: isSwitchedOn(await settings.read()) ? own : null };
  });

  server.handle(setPeers, async (input, { paseo }) => {
    const store = await peerStore;
    const { config } = await paseo.config.get();
    const own = await readOwnPeer(config.relay?.enabled === true);
    // Read the switch last, so a switch-off that lands during the awaits above is not overwritten.
    const switchedOn = isSwitchedOn(await settings.read());
    const next = peersToStore({ switchedOn, ownServerId: own?.serverId ?? null, stored: store.read(), ...input });
    store.write(next);
    return { stored: next.length };
  });

  clearPeersUnlessSwitchedOn().catch((error: unknown) => console.error("cross-daemon: could not clear peers at start", error));
  return settings.subscribe(clearPeersUnlessSwitchedOn);
}
