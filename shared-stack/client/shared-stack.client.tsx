import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { stackQueueRelease, stackQueueStatus } from "../shared/shared-stack.shared";

const POLL_INTERVAL_MS = 2000;
const time = (iso: string | null | undefined) => (iso ? iso.slice(11, 19) : "-");
const who = (entry: { agentTitle: string | null; agentId: string; workspaceName: string; daemon: string; branch: string | null }) =>
  `${entry.agentTitle ?? entry.agentId} · ${entry.workspaceName}${entry.branch ? ` (${entry.branch})` : ""} · ${entry.daemon}`;

export function SharedStackScreen({ theme, layout }: PluginScreenProps) {
  const callStatus = useRpc(stackQueueStatus);
  const callRelease = useRpc(stackQueueRelease);
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["shared-stack", "status"], queryFn: () => callStatus({}), refetchInterval: POLL_INTERVAL_MS });
  const release = useMutation({
    mutationFn: (agentId: string) => callRelease({ agentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shared-stack", "status"] }),
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: layout.compact ? 8 : 12 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "600" as const },
      heading: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const, marginTop: 8 },
      text: { color: theme.colors.foreground, fontSize: 14 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      button: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  const status = statusQuery.data;
  const error = statusQuery.error ?? release.error;
  const mine = (daemon: string) => status?.daemon === daemon;
  const releaseButton = (agentId: string, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={release.isPending} onPress={() => release.mutate(agentId)} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Shared stack</Text>
      {status ? (
        <Text style={styles.muted}>
          {`This daemon: ${status.daemon}${status.isHost ? " (hosts the stack)" : ""}. Queue folder: ${status.sharedDir}`}
        </Text>
      ) : null}
      {status?.host ? (
        <Text style={status.host.error ? styles.error : styles.muted}>
          {`Host: ${status.host.daemon}${status.host.stackUrl ? ` · ${status.host.stackUrl}` : ""} · heartbeat ${time(status.host.heartbeatAt)} · last sync ${time(status.host.appliedAt)}${status.host.error ? ` · ${status.host.error}` : ""}`}
        </Text>
      ) : (
        <Text style={styles.muted}>No host daemon has reported yet.</Text>
      )}
      {status?.error ? <Text style={styles.error}>{status.error}</Text> : null}
      {error ? <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text> : null}

      <Text style={styles.heading}>Holder</Text>
      {status?.holder ? (
        <View style={styles.row}>
          <Text style={styles.text}>{who(status.holder)}</Text>
          <Text style={styles.muted}>{`since ${time(status.holder.grantedAt)} · lease until ${time(status.holder.leaseUntil)} · synced ${time(status.holder.snapshotAt)}`}</Text>
          {mine(status.holder.daemon) ? releaseButton(status.holder.agentId, "Release") : null}
        </View>
      ) : (
        <Text style={styles.muted}>Nobody holds the stack.</Text>
      )}

      <Text style={styles.heading}>Waiting</Text>
      {status && status.waiting.length > 0 ? (
        status.waiting.map((entry, index) => (
          <View key={`${entry.daemon}-${entry.agentId}`} style={styles.row}>
            <Text style={styles.text}>{`${index + 1}. ${who(entry)}`}</Text>
            <Text style={styles.muted}>{`joined ${time(entry.joinedAt)}`}</Text>
            {mine(entry.daemon) ? releaseButton(entry.agentId, "Remove") : null}
          </View>
        ))
      ) : (
        <Text style={styles.muted}>Nobody is waiting.</Text>
      )}

      <Text style={styles.heading}>Recent events</Text>
      {[...(status?.events ?? [])].reverse().map((event, index) => (
        <Text key={`${event.at}-${index}`} style={styles.muted}>{`${time(event.at)} ${event.text}`}</Text>
      ))}
    </ScrollView>
  );
}
