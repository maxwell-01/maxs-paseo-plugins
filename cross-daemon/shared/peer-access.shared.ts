import type { CrossDaemonSettings } from "./cross-daemon.shared";

// Inbound: the peer may reach this daemon. Outbound: this daemon may reach the peer.
export type PeerAccessDirection = "inbound" | "outbound";

export function isPeerAllowed(settings: CrossDaemonSettings, serverId: string, direction: PeerAccessDirection): boolean {
  return settings.peerAccess[serverId]?.[direction] ?? settings.defaultPeerAccess === "allowed";
}

export function withPeerAccess(settings: CrossDaemonSettings, serverId: string, direction: PeerAccessDirection, allowed: boolean): CrossDaemonSettings {
  const access = { ...settings.peerAccess[serverId], [direction]: allowed };
  return { ...settings, peerAccess: { ...settings.peerAccess, [serverId]: access } };
}
