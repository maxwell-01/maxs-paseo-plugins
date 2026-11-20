import type { PluginSettingsState } from "@getpaseo/plugin/server";
import type { CrossDaemonSettings, crossDaemonSettings, Peer } from "../shared/cross-daemon.shared";
import { isPeerAllowed } from "../shared/peer-access.shared";

// Null unless the settings are readable and switched on, so unreadable settings share and keep nothing.
export function switchedOnSettings(state: PluginSettingsState<typeof crossDaemonSettings.schema>): CrossDaemonSettings | null {
  return state.status === "ready" && state.values.enabled ? state.values : null;
}

export function isSwitchedOn(state: PluginSettingsState<typeof crossDaemonSettings.schema>): boolean {
  return switchedOnSettings(state) !== null;
}

interface StoredPeerUpdate {
  settings: CrossDaemonSettings | null;
  ownServerId: string;
  stored: readonly Peer[];
  peers: readonly Peer[];
  answeredServerIds: readonly string[];
}

// A daemon that did not answer this sync may be asleep or still connecting, so its stored link stays
// until it answers switched off. A peer this daemon may not reach is never kept, whatever it gave.
export function peersToStore({ settings, ownServerId, stored, peers, answeredServerIds }: StoredPeerUpdate): Peer[] {
  if (!settings) return [];
  const answered = new Set([...answeredServerIds, ...peers.map((peer) => peer.serverId)]);
  const silent = stored.filter((peer) => !answered.has(peer.serverId));
  return [...peers, ...silent].filter((peer) => peer.serverId !== ownServerId && isPeerAllowed(settings, peer.serverId, "outbound"));
}
