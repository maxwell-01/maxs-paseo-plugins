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

// What the page learned from the hosts' plugins; null until they first answer.
export interface DaemonReadings {
  daemons: readonly DescribedDaemon[];
  failedCount: number;
}

export function buildDaemonRows(hosts: readonly PluginHostSummary[], readings: DaemonReadings | null): DaemonRow[] {
  return hosts.map(({ serverId, label, status }) => {
    if (status !== "online") return { serverId, label, state: "unavailable", detail: "Offline." };
    if (!readings) return { serverId, label, state: "unavailable", detail: "Checking…" };
    const daemon = readings.daemons.find((candidate) => candidate.serverId === serverId);
    if (!daemon && readings.failedCount > 0) {
      return { serverId, label, state: "unavailable", detail: "Could not read this daemon. It may be slow, or its plugin may be older." };
    }
    if (!daemon) {
      return { serverId, label, state: "unavailable", detail: "The cross-daemon plugin is not installed on this daemon." };
    }
    if (!daemon.switchedOn) return { serverId, label, state: "off", detail: "Switched off: no other daemon can reach it." };
    const peerLabels = daemon.peers.map((peer) => hosts.find((candidate) => candidate.serverId === peer.serverId)?.label ?? peer.name);
    const reach = peerLabels.length > 0 ? peerLabels.join(", ") : "none yet. Switch on at least one other daemon.";
    return { serverId, label, state: "on", detail: `Can reach: ${reach}` };
  });
}
