import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { registerCrossDaemon } from "./server/cross-daemon.server";
import { loadPaseoDaemon } from "./server/paseo-daemon.server";
import { createPeerStore } from "./server/peer-store.server";

export default function contribute(server: PluginServerContext) {
  const daemon = loadPaseoDaemon();
  return registerCrossDaemon(server, {
    readOwnPeer: async (relayEnabled) => (await daemon).readOwnPeer(relayEnabled),
    peerStore: daemon.then(({ home }) => createPeerStore(join(home, "plugin-data", "cross-daemon"))),
  });
}
