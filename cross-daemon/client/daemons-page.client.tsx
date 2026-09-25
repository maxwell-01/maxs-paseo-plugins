import { type PluginSurfaceProps, useHosts } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text } from "react-native";
import { buildDaemonRows, type DescribedDaemon } from "./daemon-rows.client";
import type { DaemonPort } from "./peer-sync.client";
import { listRegisteredDaemons, requestPeerSync } from "./sync-scheduler.client";

const DAEMONS_KEY = ["cross-daemon", "daemons"];
const REFRESH_MS = 5_000;

type ReachableDaemon = DescribedDaemon & { port: DaemonPort };

async function describeAll(): Promise<ReachableDaemon[]> {
  const results = await Promise.allSettled(
    listRegisteredDaemons().map(async (port) => {
      const [described, peers] = await Promise.all([port.describe(), port.listPeers()]);
      return { serverId: described.serverId, switchedOn: described.switchedOn, peers, port };
    }),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export function DaemonsPage({ theme, layout }: PluginSurfaceProps) {
  const hosts = useHosts();
  const queryClient = useQueryClient();
  const daemons = useQuery({ queryKey: DAEMONS_KEY, queryFn: describeAll, refetchInterval: REFRESH_MS });
  const toggle = useMutation({
    mutationFn: async ({ port, switchedOn }: { port: DaemonPort; switchedOn: boolean }) => port.setSwitch(switchedOn),
    onSuccess: async () => {
      requestPeerSync();
      await queryClient.invalidateQueries({ queryKey: DAEMONS_KEY });
    },
  });
  const rows = buildDaemonRows(hosts, daemons.data ?? []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24 }}>
      <SettingsSection title="Cross-daemon">
        <Text style={{ color: theme.colors.foreground, marginBottom: 12 }}>
          Agents on switched-on daemons can list and message agents on the other switched-on daemons.
        </Text>
        {toggle.error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, marginBottom: 12 }}>
            {toggle.error.message}
          </Text>
        ) : null}
        <SettingsCard>
          {rows.map((row) => {
            const daemon = daemons.data?.find((candidate) => candidate.serverId === row.serverId);
            return (
              <SettingsSwitch
                key={row.serverId}
                label={row.label}
                hint={row.detail}
                value={row.state === "on"}
                disabled={row.state === "unavailable" || !daemon || toggle.isPending}
                onValueChange={(switchedOn) => daemon && toggle.mutate({ port: daemon.port, switchedOn })}
              />
            );
          })}
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
