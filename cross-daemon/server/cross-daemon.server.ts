import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { crossDaemonSettings, describeDaemon, listPeers, type Peer, setOwnPassword, setPeers } from "../shared/cross-daemon.shared";
import { withCrossDaemonTools } from "./agent-injection.server";
import { createAgentLifecycle } from "./agent-lifecycle.server";
import type { PaseoCli } from "./paseo-cli.server";
import { createMessenger, startDeliveryWorker } from "./messenger.server";
import { createMessageQueue } from "./message-queue.server";
import { createOwnPasswordStore } from "./own-password-store.server";
import { createPeerStore } from "./peer-store.server";
import { createStartedAgents } from "./started-agents.server";
import { createWatchList } from "./watch-list.server";
import { isSwitchedOn, peersToStore } from "./switch-policy.server";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";
import { createTools, type DaemonIdentity } from "./tools.server";

const DELIVERY_INTERVAL_MS = 15_000;

interface CrossDaemonDependencies {
  readOwnPeer(relayEnabled: boolean): Promise<Peer | null>;
  stateDir: Promise<string>;
  cli: PaseoCli;
  ownDaemon(): Promise<DaemonIdentity>;
}

function startToolServer(
  stateDir: string,
  peers: ReturnType<typeof createPeerStore>,
  { cli, ownDaemon }: Pick<CrossDaemonDependencies, "cli" | "ownDaemon">,
) {
  const queue = createMessageQueue(stateDir);
  const watches = createWatchList(stateDir);
  const readPeers = () => peers.read();
  const messenger = createMessenger({ queue, watches, readPeers, cli });
  const lifecycle = createAgentLifecycle({ cli, watches, startedAgents: createStartedAgents(stateDir) });
  const tools = createTools({ readPeers, cli, messenger, lifecycle, ownDaemon });
  const socketPath = join(stateDir, "tools.sock");
  const stopServing = serveTools(socketPath, tools);
  const stopDelivering = startDeliveryWorker(messenger, DELIVERY_INTERVAL_MS);
  const proxyPath = installToolProxy(stateDir, { socketPath, tools: tools.definitions });
  const stop = () => {
    stopServing();
    stopDelivering();
  };
  return { launch: { command: process.execPath, proxyPath }, toolNames: tools.definitions.map((tool) => tool.name), stop };
}

export function registerCrossDaemon(server: PluginServerContext, { readOwnPeer, stateDir, cli, ownDaemon }: CrossDaemonDependencies) {
  const settings = server.registerSettings(crossDaemonSettings);
  const peerStore = stateDir.then(createPeerStore);
  const toolServer = Promise.all([stateDir, peerStore]).then(([dir, peers]) => startToolServer(dir, peers, { cli, ownDaemon }));
  toolServer.catch((error: unknown) => console.error("cross-daemon: the tool server did not start", error));
  const clearPeersUnlessSwitchedOn = async () => {
    const peers = await peerStore;
    if (!isSwitchedOn(await settings.read())) peers.write([]);
  };

  // A plugin fault must not stop agents being created: they start without the cross-daemon tools.
  server.before("agent.create", async ({ request }) => {
    try {
      const { launch, toolNames } = await toolServer;
      return { ...request, config: withCrossDaemonTools(request.config, launch, toolNames) };
    } catch {
      return request;
    }
  });

  server.handle(describeDaemon, async (_input, { paseo }) => {
    const { config } = await paseo.config.get();
    const own = await readOwnPeer(config.relay?.enabled === true);
    const password = createOwnPasswordStore(await stateDir).read();
    const switchedOn = isSwitchedOn(await settings.read());
    const member = switchedOn && own ? { ...own, ...(password ? { password } : {}) } : null;
    return { serverId: own?.serverId ?? (await ownDaemon()).serverId, switchedOn, passwordSet: password !== null, member };
  });

  server.handle(setOwnPassword, async ({ password }) => {
    createOwnPasswordStore(await stateDir).write(password);
    return { passwordSet: password !== null };
  });

  server.handle(setPeers, async (input, { paseo }) => {
    const peers = await peerStore;
    const { config } = await paseo.config.get();
    const ownServerId = (await readOwnPeer(config.relay?.enabled === true))?.serverId ?? (await ownDaemon()).serverId;
    // Read the switch last, so a switch-off that lands during the awaits above is not overwritten.
    const switchedOn = isSwitchedOn(await settings.read());
    const next = peersToStore({ switchedOn, ownServerId, stored: peers.read(), ...input });
    peers.write(next);
    return { stored: next.length };
  });

  server.handle(listPeers, async () => ({
    peers: (await peerStore).read().map(({ serverId, name }) => ({ serverId, name })),
  }));

  clearPeersUnlessSwitchedOn().catch((error: unknown) => console.error("cross-daemon: could not clear peers at start", error));
  const unsubscribe = settings.subscribe(clearPeersUnlessSwitchedOn);
  return async () => {
    unsubscribe();
    (await toolServer).stop();
  };
}
