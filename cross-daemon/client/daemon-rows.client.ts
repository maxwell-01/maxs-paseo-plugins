import type { PluginHostSummary } from "@getpaseo/plugin/client";

export interface DescribedDaemon {
  serverId: string;
  switchedOn: boolean;
  peers: readonly { serverId: string; name: string }[];
}

export interface DaemonRow {
  serverId: string;
  label: string;
  state: "on" | "off" | "unavailable";
  detail: string;
}

export function buildDaemonRows(hosts: readonly PluginHostSummary[], daemons: readonly DescribedDaemon[]): DaemonRow[] {
  return hosts.map(({ serverId, label, status }) => {
    const daemon = daemons.find((candidate) => candidate.serverId === serverId);
    if (status !== "online") return { serverId, label, state: "unavailable", detail: "Offline." };
    if (!daemon) {
      return { serverId, label, state: "unavailable", detail: "The cross-daemon plugin is not installed on this daemon." };
    }
    if (!daemon.switchedOn) return { serverId, label, state: "off", detail: "Switched off: no other daemon can reach it." };
    const peerLabels = daemon.peers.map((peer) => hosts.find((candidate) => candidate.serverId === peer.serverId)?.label ?? peer.name);
    const reach = peerLabels.length > 0 ? peerLabels.join(", ") : "none yet. Switch on at least one other daemon.";
    return { serverId, label, state: "on", detail: `Can reach: ${reach}` };
  });
}
