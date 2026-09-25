import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { settingsRpc } from "@getpaseo/plugin";
import { crossDaemonSettings, describeDaemon, listPeers, setPeers } from "../shared/cross-daemon.shared";

const switchSettings = settingsRpc(crossDaemonSettings.id);

export type DaemonDescription = z.output<typeof describeDaemon.output>;
export type PeerUpdate = z.input<typeof setPeers.input>;

export interface DaemonPort {
  describe(): Promise<DaemonDescription>;
  setPeers(update: PeerUpdate): Promise<void>;
  listPeers(): Promise<{ serverId: string; name: string }[]>;
  setSwitch(switchedOn: boolean): Promise<void>;
}

export function createDaemonPort(rpc: PluginClientContext["rpc"]): DaemonPort {
  return {
    describe: () => rpc(describeDaemon, {}),
    setPeers: async (update) => {
      await rpc(setPeers, update);
    },
    listPeers: async () => (await rpc(listPeers, {})).peers,
    setSwitch: async (switchedOn) => {
      const current = await rpc(switchSettings.read, {});
      const values: z.input<typeof crossDaemonSettings.schema> = { enabled: switchedOn };
      const saved = await rpc(switchSettings.write, { values, revision: current.revision });
      if (saved.status !== "saved") throw new Error(`Could not save the switch: ${saved.error}`);
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
  const answeredServerIds = answered.map(({ daemon }) => daemon.serverId);
  const deliveries = await Promise.allSettled(
    answered.map(({ port, daemon }) =>
      port.setPeers({ peers: members.filter((member) => member.serverId !== daemon.serverId), answeredServerIds }),
    ),
  );
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") console.warn("cross-daemon: a host rejected its peer list", delivery.reason);
  }
}
