import type { PluginHostSummary } from "@getpaseo/plugin/client";
import type { CrossDaemonSettings } from "../shared/cross-daemon.shared";
import { isPeerAllowed } from "../shared/peer-access.shared";

export interface PeerAccessRow {
  serverId: string;
  label: string;
  inbound: boolean;
  outbound: boolean;
  // Blocked from reaching this daemon, yet still lists it as a peer: it holds this daemon's link.
  stillHoldsLink: boolean;
}

interface PeerAccessSources {
  ownServerId: string;
  hosts: readonly PluginHostSummary[];
  storedPeers: readonly { serverId: string; name: string }[];
  daemons: readonly { serverId: string; peers: readonly { serverId: string }[] }[];
  settings: CrossDaemonSettings;
}

export function buildPeerAccessRows({ ownServerId, hosts, storedPeers, daemons, settings }: PeerAccessSources): PeerAccessRow[] {
  // A peer with a choice of its own keeps its row even when nothing else lists it, so the choice can be undone.
  const candidates = [
    ...hosts.map(({ serverId, label }) => ({ serverId, label })),
    ...storedPeers.map(({ serverId, name }) => ({ serverId, label: name })),
    ...Object.keys(settings.peerAccess).map((serverId) => ({ serverId, label: serverId })),
  ];
  const known = candidates.filter((candidate, index) => candidates.findIndex(({ serverId }) => serverId === candidate.serverId) === index);
  return known
    .filter(({ serverId }) => serverId !== ownServerId)
    .map(({ serverId, label }) => {
      const inbound = isPeerAllowed(settings, serverId, "inbound");
      const listsThisDaemon = daemons.find((daemon) => daemon.serverId === serverId)?.peers.some((peer) => peer.serverId === ownServerId) ?? false;
      return { serverId, label, inbound, outbound: isPeerAllowed(settings, serverId, "outbound"), stillHoldsLink: !inbound && listsThisDaemon };
    });
}
