import type { Peer } from "../shared/cross-daemon.shared";
import type { OwnDaemon } from "./own-daemon.server";

export function describeOwnDaemon(own: OwnDaemon, enabled: boolean) {
  return { ...own, enabled, link: enabled ? own.link : null };
}

export function peersToStore(input: { enabled: boolean; ownServerId: string; peers: readonly Peer[] }): Peer[] {
  if (!input.enabled) return [];
  return input.peers.filter((peer) => peer.serverId !== input.ownServerId);
}
