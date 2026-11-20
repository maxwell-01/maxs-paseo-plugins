import { type SettingsState, useHosts, useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { type CrossDaemonSettings, crossDaemonSettings, describeDaemon } from "../shared/cross-daemon.shared";
import { type PeerAccessDirection, withPeerAccess } from "../shared/peer-access.shared";
import { DAEMONS_KEY, DAEMONS_REFRESH_MS, describeAll } from "./daemons-section.client";
import { DESCRIPTION_KEY } from "./own-password-rows.client";
import { buildPeerAccessRows } from "./peer-access-rows.client";
import { requestPeerSync } from "./sync-scheduler.client";

type ReadySettings = Extract<SettingsState<typeof crossDaemonSettings.schema>, { status: "ready" }>;

const DEFAULT_ACCESS_OPTIONS = [
  { label: "Allowed", value: "allowed" },
  { label: "Blocked", value: "blocked" },
] as const;

const STILL_HOLDS_LINK =
  "It still holds this daemon's link. It drops it at the next sync while the app is open. If it keeps it, change this daemon's password.";

export function PeerAccessSection({ settings, storedPeers }: { settings: ReadySettings; storedPeers: readonly { serverId: string; name: string }[] }) {
  const hosts = useHosts();
  const callDescribe = useRpc(describeDaemon);
  const description = useQuery({ queryKey: DESCRIPTION_KEY, queryFn: () => callDescribe({}) });
  const daemons = useQuery({ queryKey: DAEMONS_KEY, queryFn: describeAll, refetchInterval: DAEMONS_REFRESH_MS });
  const save = async (values: CrossDaemonSettings) => {
    if (await settings.save(values, settings.revision)) requestPeerSync();
  };
  const setAccess = (serverId: string, direction: PeerAccessDirection, allowed: boolean) =>
    void save(withPeerAccess(settings.values, serverId, direction, allowed));
  const rows = description.data
    ? buildPeerAccessRows({ ownServerId: description.data.serverId, hosts, storedPeers, daemons: daemons.data?.daemons ?? [], settings: settings.values })
    : [];

  return (
    <SettingsSection title="Per-daemon access">
      <SettingsCard>
        <SettingsSelect
          label="Daemons not set below"
          hint="Whether a daemon you have not set may reach this one, and this one it. Daemons added later get this too."
          value={settings.values.defaultPeerAccess}
          options={DEFAULT_ACCESS_OPTIONS}
          disabled={settings.saving}
          error={settings.saveError}
          onValueChange={(defaultPeerAccess) => void save({ ...settings.values, defaultPeerAccess })}
        />
      </SettingsCard>
      {rows.map((row) => (
        <SettingsCard key={row.serverId}>
          <SettingsSwitch
            label={`${row.label} can reach this daemon`}
            hint={row.stillHoldsLink ? STILL_HOLDS_LINK : "Off: this daemon gives it no link or password."}
            value={row.inbound}
            disabled={settings.saving}
            onValueChange={(allowed) => setAccess(row.serverId, "inbound", allowed)}
          />
          <SettingsSwitch
            label={`This daemon can reach ${row.label}`}
            hint="Off: this daemon keeps no link to it, and its agents cannot reach it."
            value={row.outbound}
            disabled={settings.saving}
            onValueChange={(allowed) => setAccess(row.serverId, "outbound", allowed)}
          />
        </SettingsCard>
      ))}
    </SettingsSection>
  );
}
