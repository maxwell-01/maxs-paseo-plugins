import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { describeDaemon, setPeers } from "../shared/cross-daemon.shared";

export type DaemonDescription = z.output<typeof describeDaemon.output>;
export type PeerUpdate = z.input<typeof setPeers.input>;

export interface DaemonPort {
  describe(): Promise<DaemonDescription>;
  setPeers(update: PeerUpdate): Promise<void>;
}

export function createDaemonPort(rpc: PluginClientContext["rpc"]): DaemonPort {
  return {
    describe: () => rpc(describeDaemon, {}),
    setPeers: async (update) => {
      await rpc(setPeers, update);
    },
  };
}

export async function syncPeers(ports: readonly DaemonPort[]): Promise<void> {
  const results = await Promise.allSettled(ports.map((port) => port.describe()));
  const answered = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [{ port: ports[index], daemon: result.value }];
    console.warn("cross-daemon: a host did not answer the peer sync", result.reason);
    return [];
  });
  const members = answered.flatMap(({ daemon }) => (daemon.member ? [daemon.member] : []));
  const answeredServerIds = answered.flatMap(({ daemon }) => (daemon.serverId ? [daemon.serverId] : []));
  const deliveries = await Promise.allSettled(
    answered.map(({ port, daemon }) =>
      port.setPeers({ peers: members.filter((member) => member.serverId !== daemon.serverId), answeredServerIds }),
    ),
  );
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") console.warn("cross-daemon: a host rejected its peer list", delivery.reason);
  }
}
