import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { crossDaemonSettings, describeDaemon, listPeerNames, type Peer, setPeers } from "../shared/cross-daemon.shared";
import { withCrossDaemonTools } from "./agent-injection.server";
import { createPeerStore } from "./peer-store.server";
import { isSwitchedOn, peersToStore } from "./switch-policy.server";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";
import { createTools } from "./tools.server";

interface CrossDaemonDependencies {
  readOwnPeer(relayEnabled: boolean): Promise<Peer | null>;
  stateDir: Promise<string>;
}

async function startToolServer(stateDir: string) {
  const peers = createPeerStore(stateDir);
  const tools = createTools({ readPeers: () => peers.read() });
  const socketPath = join(stateDir, "tools.sock");
  const stopServing = serveTools(socketPath, tools);
  const launch = { command: process.execPath, proxyPath: installToolProxy(stateDir), socketPath };
  return { peers, toolNames: tools.definitions.map((tool) => tool.name), launch, stopServing };
}

export function registerCrossDaemon(server: PluginServerContext, { readOwnPeer, stateDir }: CrossDaemonDependencies) {
  const settings = server.registerSettings(crossDaemonSettings);
  const toolServer = stateDir.then(startToolServer);
  const clearPeersUnlessSwitchedOn = async () => {
    const { peers } = await toolServer;
    if (!isSwitchedOn(await settings.read())) peers.write([]);
  };

  server.before("agent.create", async ({ request }) => {
    const { launch, toolNames } = await toolServer;
    return { ...request, config: withCrossDaemonTools(request.config, launch, toolNames) };
  });

  server.handle(describeDaemon, async (_input, { paseo }) => {
    const { config } = await paseo.config.get();
    const own = await readOwnPeer(config.relay?.enabled === true);
    return { serverId: own?.serverId ?? null, member: isSwitchedOn(await settings.read()) ? own : null };
  });

  server.handle(setPeers, async (input, { paseo }) => {
    const { peers } = await toolServer;
    const { config } = await paseo.config.get();
    const own = await readOwnPeer(config.relay?.enabled === true);
    // Read the switch last, so a switch-off that lands during the awaits above is not overwritten.
    const switchedOn = isSwitchedOn(await settings.read());
    const next = peersToStore({ switchedOn, ownServerId: own?.serverId ?? null, stored: peers.read(), ...input });
    peers.write(next);
    return { stored: next.length };
  });

  server.handle(listPeerNames, async () => ({ names: (await toolServer).peers.read().map((peer) => peer.name) }));

  clearPeersUnlessSwitchedOn().catch((error: unknown) => console.error("cross-daemon: could not clear peers at start", error));
  const unsubscribe = settings.subscribe(clearPeersUnlessSwitchedOn);
  return async () => {
    unsubscribe();
    (await toolServer).stopServing();
  };
}
