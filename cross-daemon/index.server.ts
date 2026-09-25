import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hostname } from "node:os";
import { join } from "node:path";
import { registerCrossDaemon } from "./server/cross-daemon.server";
import { createPaseoCli } from "./server/paseo-cli.server";
import { loadPaseoDaemon, resolvePaseoCli } from "./server/paseo-daemon.server";

export default function contribute(server: PluginServerContext) {
  const daemon = loadPaseoDaemon();
  return registerCrossDaemon(server, {
    readOwnPeer: async (relayEnabled) => (await daemon).readOwnPeer(relayEnabled),
    stateDir: daemon.then(({ home }) => join(home, "plugin-data", "cross-daemon")),
    // Found per call, so a daemon without the CLI still runs the switch and the sync.
    cli: { run: async (link, args, options) => createPaseoCli(resolvePaseoCli()).run(link, args, options) },
    ownDaemon: async () => ({ name: hostname(), serverId: await (await daemon).readOwnServerId() }),
  });
}
