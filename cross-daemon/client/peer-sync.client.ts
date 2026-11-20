import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { settingsRpc } from "@getpaseo/plugin";
import { crossDaemonSettings, describeDaemon, grantAccess, listPeers, setPeers } from "../shared/cross-daemon.shared";

const switchSettings = settingsRpc(crossDaemonSettings.id);

export type DaemonDescription = z.output<typeof describeDaemon.output>;
export type Grant = z.output<typeof grantAccess.output>["grants"][number];
export type PeerUpdate = z.input<typeof setPeers.input>;

export interface DaemonPort {
  describe(): Promise<DaemonDescription>;
  grantAccess(to: string[]): Promise<Grant[]>;
  setPeers(update: PeerUpdate): Promise<void>;
  listPeers(): Promise<{ serverId: string; name: string }[]>;
  setSwitch(switchedOn: boolean): Promise<void>;
}

export function createDaemonPort(rpc: PluginClientContext["rpc"]): DaemonPort {
  return {
    describe: () => rpc(describeDaemon, {}),
    grantAccess: async (to) => (await rpc(grantAccess, { to })).grants,
    setPeers: async (update) => {
      await rpc(setPeers, update);
    },
    listPeers: async () => (await rpc(listPeers, {})).peers,
    setSwitch: async (switchedOn) => {
      const current = await rpc(switchSettings.read, {});
      if (current.status !== "ready") throw new Error(`Could not read the settings: ${current.error}`);
      const values = { ...crossDaemonSettings.schema.parse(current.values), enabled: switchedOn };
      const saved = await rpc(switchSettings.write, { values, revision: current.revision });
      if (saved.status !== "saved") throw new Error(`Could not save the switch: ${saved.error}`);
    },
  };
}

// Grants are addressed by the server ID each host reports. Two hosts reporting one ID cannot both be
// that daemon, so neither gives nor gets a link, and each is told to drop the links it holds.
function splitSharedServerIds<T extends { daemon: DaemonDescription }>(answered: readonly T[]): { unique: T[]; shared: T[] } {
  const counts = new Map<string, number>();
  for (const { daemon } of answered) counts.set(daemon.serverId, (counts.get(daemon.serverId) ?? 0) + 1);
  for (const [serverId, count] of counts) {
    if (count > 1) console.warn(`cross-daemon: ${count} hosts claim server ID ${serverId}; none of them gets or gives a link`);
  }
  return {
    unique: answered.filter(({ daemon }) => counts.get(daemon.serverId) === 1),
    shared: answered.filter(({ daemon }) => counts.get(daemon.serverId) !== 1),
  };
}

// A daemon may grant only its own link, and only to a daemon it was asked about.
function isOwnGrant(grantorServerId: string, askedServerIds: readonly string[], grant: Grant): boolean {
  if (grant.peer.serverId === grantorServerId && askedServerIds.includes(grant.to)) return true;
  console.warn(`cross-daemon: ignored a grant from ${grantorServerId} of ${grant.peer.serverId}'s link to ${grant.to}`);
  return false;
}

export async function syncPeers(ports: readonly DaemonPort[]): Promise<void> {
  const results = await Promise.allSettled(ports.map((port) => port.describe()));
  const { unique: answered, shared } = splitSharedServerIds(
    results.flatMap((result, index) => {
      if (result.status === "fulfilled") return [{ port: ports[index], daemon: result.value }];
      console.warn("cross-daemon: a host did not answer the peer sync", result.reason);
      return [];
    }),
  );
  const serverIds = answered.map(({ daemon }) => daemon.serverId);
  const othersThan = (serverId: string) => serverIds.filter((other) => other !== serverId);
  const granted = await Promise.allSettled(answered.map(({ port, daemon }) => port.grantAccess(othersThan(daemon.serverId))));
  const grants = answered.flatMap(({ daemon }, index) => {
    const result = granted[index];
    if (result.status === "rejected") {
      console.warn("cross-daemon: a host did not grant access", result.reason);
      return [];
    }
    return result.value.filter((grant) => isOwnGrant(daemon.serverId, othersThan(daemon.serverId), grant));
  });
  // A daemon whose grants failed did not answer: its peers keep the link they have.
  const answeredServerIds = answered.filter((_, index) => granted[index].status === "fulfilled").map(({ daemon }) => daemon.serverId);
  const deliveries = await Promise.allSettled([
    ...answered.map(({ port, daemon }) =>
      port.setPeers({ peers: grants.filter((grant) => grant.to === daemon.serverId).map((grant) => grant.peer), answeredServerIds }),
    ),
    ...shared.map(({ port }) => port.setPeers({ peers: [], answeredServerIds })),
  ]);
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") console.warn("cross-daemon: a host rejected its peer list", delivery.reason);
  }
}
