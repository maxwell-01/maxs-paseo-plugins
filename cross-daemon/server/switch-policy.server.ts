import type { PluginSettingsState } from "@getpaseo/plugin/server";
import type { crossDaemonSettings, Peer } from "../shared/cross-daemon.shared";

export function isSwitchedOn(state: PluginSettingsState<typeof crossDaemonSettings.schema>): boolean {
  return state.status === "ready" && state.values.enabled;
}

interface PeerUpdate {
  switchedOn: boolean;
  ownServerId: string | null;
  stored: readonly Peer[];
  peers: readonly Peer[];
  answeredServerIds: readonly string[];
}

// A daemon that did not answer this sync may be asleep or still connecting, so its stored link stays
// until it answers switched off.
export function peersToStore(update: PeerUpdate): Peer[] {
  if (!update.switchedOn) return [];
  const answered = new Set([...update.answeredServerIds, ...update.peers.map((peer) => peer.serverId)]);
  const silent = update.stored.filter((peer) => !answered.has(peer.serverId));
  return [...update.peers, ...silent].filter((peer) => peer.serverId !== update.ownServerId);
}
