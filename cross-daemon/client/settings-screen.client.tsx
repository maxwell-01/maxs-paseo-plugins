import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { crossDaemonSettings, listPeers } from "../shared/cross-daemon.shared";
import { requestPeerSync } from "./sync-scheduler.client";

const PEERS_KEY = ["cross-daemon", "peers"];
const PEER_NAMES_REFRESH_MS = 5_000;

function describeReach(names: readonly string[] | undefined, failed: boolean): string {
  if (failed) return "Could not read this daemon's peers.";
  if (!names) return "Checking…";
  if (names.length === 0) return "None yet. Switch this on for at least two daemons while the app is open.";
  return names.join(", ");
}

export function CrossDaemonSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(crossDaemonSettings);
  const callListPeers = useRpc(listPeers);
  const peers = useQuery({
    queryKey: PEERS_KEY,
    queryFn: () => callListPeers({}),
    refetchInterval: PEER_NAMES_REFRESH_MS,
  });

  if (settings.status === "loading") return <Text style={{ color: theme.colors.foreground }}>Loading settings…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Cross-daemon">
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
          {settings.error}
        </Text>
        <SettingsCard>
          <SettingsAction label="Read settings again" actionLabel="Reload" onPress={settings.reload} />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="Replace invalid settings with defaults (switched off)"
              actionLabel="Reset"
              disabled={settings.saving}
              onPress={async () => {
                await settings.reset();
              }}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }

  const saveEnabled = async (enabled: boolean) => {
    if (await settings.save({ enabled }, settings.revision)) requestPeerSync();
  };

  return (
    <SettingsSection title="Cross-daemon">
      <SettingsCard>
        <SettingsSwitch
          label="Allow cross-daemon comms"
          hint="Agents on this daemon can reach agents on other switched-on daemons, and theirs can reach this one."
          value={settings.values.enabled}
          disabled={settings.saving}
          error={settings.saveError}
          onValueChange={(enabled) => void saveEnabled(enabled)}
        />
        <SettingsRow
          label="Can reach"
          hint={describeReach(peers.data?.peers.map((peer) => peer.name), peers.isError)}
          error={peers.error?.message ?? null}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
