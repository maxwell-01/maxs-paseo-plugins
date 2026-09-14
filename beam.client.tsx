import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./beam.shared";

const POLL_INTERVAL_MS = 1000;
const monospace = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export function BeamPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (w) => ({ dir: w.directory, name: w.name }));
  const callStatus = useRpc(beamStatus);
  const callLog = useRpc(beamLog);
  const callActivate = useRpc(beamActivate);
  const callDeactivate = useRpc(beamDeactivate);
  const queryClient = useQueryClient();
  const logScrollRef = useRef<ScrollView>(null);

  const statusKey = ["beam", "status", workspaceId];
  const logKey = ["beam", "log", workspaceId];
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () => callStatus({}),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const logQuery = useQuery({
    queryKey: logKey,
    queryFn: () => callLog({}),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: statusKey });
    queryClient.invalidateQueries({ queryKey: logKey });
  };

  const activateMutation = useMutation({
    mutationFn: () => {
      if (!workspace) {
        throw new Error("workspace directory is not available yet");
      }
      return callActivate({ workspaceId, workspaceDir: workspace.dir });
    },
    onSuccess: refreshAll,
  });
  const deactivateMutation = useMutation({
    mutationFn: () => callDeactivate({}),
    onSuccess: refreshAll,
  });

  const beam = statusQuery.data;
  const active = beam?.active ?? false;
  const pending =
    statusQuery.isLoading || activateMutation.isPending || deactivateMutation.isPending;
  const error = activateMutation.error ?? deactivateMutation.error ?? statusQuery.error;
  const logEntries = logQuery.data?.entries ?? [];

  const restoreHint =
    active && beam?.originalBranch
      ? `Beam out restores main to ${beam.originalBranch} automatically.`
      : null;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 8 : 12,
        backgroundColor: theme.colors.surface0,
      },
      name: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 18 : 22,
        fontWeight: "600" as const,
      },
      state: { color: theme.colors.foregroundMuted, fontSize: 14 },
      warning: { color: theme.colors.statusWarning, fontSize: 13 },
      button: {
        alignSelf: "flex-start" as const,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
      },
      buttonIn: { backgroundColor: theme.colors.accent },
      buttonOut: {
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      buttonDisabled: { opacity: 0.5 },
      buttonTextIn: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      buttonTextOut: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      logContainer: {
        flex: 1,
        marginTop: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      },
      logContent: { padding: 8, gap: 2 },
      logLine: { fontSize: 12, fontFamily: monospace },
      logInfo: { color: theme.colors.foreground },
      logWarn: { color: theme.colors.statusWarning },
      logError: { color: theme.colors.statusDanger },
      logEmpty: { color: theme.colors.foregroundMuted, fontSize: 12, padding: 8 },
    }),
    [theme, layout.compact],
  );

  const logLineStyle = (level: "info" | "warn" | "error") =>
    level === "error" ? styles.logError : level === "warn" ? styles.logWarn : styles.logInfo;

  return (
    <View style={styles.screen}>
      <Text style={styles.name}>{workspace?.name ?? "Workspace"}</Text>
      <Text style={styles.state}>
        {active ? "Beam active: mirroring to main" : "Beam inactive"}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          active
            ? "Beam out: stop mirroring this workspace to your main checkout"
            : "Beam in: continuously mirror this workspace's working tree onto your main checkout"
        }
        disabled={pending}
        onPress={() => (active ? deactivateMutation.mutate() : activateMutation.mutate())}
        style={[
          styles.button,
          active ? styles.buttonOut : styles.buttonIn,
          pending ? styles.buttonDisabled : null,
        ]}
      >
        <Text style={active ? styles.buttonTextOut : styles.buttonTextIn}>
          {active ? "Beam out" : "Beam in"}
        </Text>
      </Pressable>
      {restoreHint ? <Text style={styles.warning}>{restoreHint}</Text> : null}
      {error ? (
        <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>
      ) : null}
      <ScrollView
        ref={logScrollRef}
        style={styles.logContainer}
        contentContainerStyle={styles.logContent}
        onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: false })}
      >
        {logEntries.length === 0 ? (
          <Text style={styles.logEmpty}>No beam activity yet.</Text>
        ) : (
          logEntries.map((entry, index) => (
            <Text
              key={`${entry.ts}-${index}`}
              style={[styles.logLine, logLineStyle(entry.level)]}
            >
              {`${entry.ts.slice(11, 19)} ${entry.message}`}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}
