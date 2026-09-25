import type { PluginClientContext } from "@getpaseo/plugin/client";
import { describeDaemon, type Peer, setPeers } from "../shared/cross-daemon.shared";

export interface DaemonDescription {
  serverId: string;
  name: string;
  enabled: boolean;
  link: string | null;
}

export interface DaemonPort {
  describe(): Promise<DaemonDescription>;
  setPeers(peers: Peer[]): Promise<void>;
}

export function createDaemonPort(rpc: PluginClientContext["rpc"]): DaemonPort {
  return {
    describe: () => rpc(describeDaemon, {}),
    setPeers: async (peers) => {
      await rpc(setPeers, { peers });
    },
  };
}

function asMeshMember(daemon: DaemonDescription): Peer | null {
  return daemon.enabled && daemon.link ? { serverId: daemon.serverId, name: daemon.name, link: daemon.link } : null;
}

export async function syncPeers(ports: readonly DaemonPort[]): Promise<void> {
  const results = await Promise.allSettled(ports.map((port) => port.describe()));
  const reachable = new Map<string, { port: DaemonPort; daemon: DaemonDescription }>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && !reachable.has(result.value.serverId)) {
      reachable.set(result.value.serverId, { port: ports[index], daemon: result.value });
    }
  });
  const mesh = [...reachable.values()].flatMap(({ daemon }) => asMeshMember(daemon) ?? []);
  await Promise.allSettled(
    [...reachable.values()].map(({ port, daemon }) =>
      port.setPeers(asMeshMember(daemon) ? mesh.filter((peer) => peer.serverId !== daemon.serverId) : []),
    ),
  );
}
