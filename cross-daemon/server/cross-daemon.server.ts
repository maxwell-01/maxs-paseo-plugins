import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  crossDaemonSettings,
  describeDaemon,
  listPeers,
  type Peer,
  type PeerPasswordSource,
  setOwnPassword,
  setPeerPassword,
  setPeers,
} from "../shared/cross-daemon.shared";
import { withCrossDaemonTools } from "./agent-injection.server";
import { createAgentLifecycle } from "./agent-lifecycle.server";
import type { PaseoCli } from "./paseo-cli.server";
import { createMessenger, startDeliveryWorker } from "./messenger.server";
import { createMessageQueue } from "./message-queue.server";
import { openPasswordStores, type PasswordStores } from "./password-stores.server";
import { withPeerPasswords } from "./peer-password-store.server";
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
  daemonSecretKey: Promise<Uint8Array>;
  cli: PaseoCli;
  ownDaemon(): Promise<DaemonIdentity>;
}

function startToolServer(
  stateDir: string,
  { peers, peerPasswords }: PasswordStores,
  { cli, ownDaemon }: Pick<CrossDaemonDependencies, "cli" | "ownDaemon">,
) {
  const queue = createMessageQueue(stateDir);
  const watches = createWatchList(stateDir);
  const readPeers = () => withPeerPasswords(peers.read(), peerPasswords.read());
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

export function registerCrossDaemon(
  server: PluginServerContext,
  { readOwnPeer, stateDir, daemonSecretKey, cli, ownDaemon }: CrossDaemonDependencies,
) {
  const settings = server.registerSettings(crossDaemonSettings);
  const stores = Promise.all([stateDir, daemonSecretKey]).then(([dir, key]) => openPasswordStores(dir, key));
  const toolServer = Promise.all([stateDir, stores]).then(([dir, opened]) => startToolServer(dir, opened, { cli, ownDaemon }));
  toolServer.catch((error: unknown) => console.error("cross-daemon: the tool server did not start", error));
  const clearPeersUnlessSwitchedOn = async () => {
    const { peers } = await stores;
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
    const { ownPassword } = await stores;
    const password = ownPassword.read();
    const switchedOn = isSwitchedOn(await settings.read());
    const member = switchedOn && own ? { ...own, ...(password ? { password } : {}) } : null;
    return {
      serverId: own?.serverId ?? (await ownDaemon()).serverId,
      switchedOn,
      passwordSet: password !== null,
      ...(ownPassword.isUnreadable() ? { passwordUnreadable: true as const } : {}),
      member,
    };
  });

  server.handle(setOwnPassword, async ({ password }) => {
    (await stores).ownPassword.write(password);
    return { passwordSet: password !== null };
  });

  server.handle(setPeers, async (input, { paseo }) => {
    const { peers } = await stores;
    const { config } = await paseo.config.get();
    const ownServerId = (await readOwnPeer(config.relay?.enabled === true))?.serverId ?? (await ownDaemon()).serverId;
    // Read the switch last, so a switch-off that lands during the awaits above is not overwritten.
    const switchedOn = isSwitchedOn(await settings.read());
    const next = peersToStore({ switchedOn, ownServerId, stored: peers.read(), ...input });
    peers.write(next);
    return { stored: next.length };
  });

  server.handle(setPeerPassword, async ({ serverId, password }) => {
    (await stores).peerPasswords.write(serverId, password);
    return { passwordSet: password !== null };
  });

  server.handle(listPeers, async () => {
    const { peers, peerPasswords } = await stores;
    const passwordsSetHere = peerPasswords.read();
    const unreadableHere = new Set(peerPasswords.unreadableServerIds());
    const passwordSource = (peer: Peer): PeerPasswordSource => {
      if (peer.password) return "announced";
      if (passwordsSetHere[peer.serverId]) return "set-here";
      return unreadableHere.has(peer.serverId) ? "unreadable" : "none";
    };
    return { peers: peers.read().map((peer) => ({ serverId: peer.serverId, name: peer.name, password: passwordSource(peer) })) };
  });

  clearPeersUnlessSwitchedOn().catch((error: unknown) => console.error("cross-daemon: could not clear peers at start", error));
  const unsubscribe = settings.subscribe(clearPeersUnlessSwitchedOn);
  return async () => {
    unsubscribe();
    (await toolServer).stop();
  };
}
