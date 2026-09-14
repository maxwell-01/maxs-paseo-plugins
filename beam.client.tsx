import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { beamActivate, beamDeactivate, beamStatus } from "./beam.shared";

export function BeamPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (w) => ({ dir: w.directory, name: w.name }));
  const callStatus = useRpc(beamStatus);
  const callActivate = useRpc(beamActivate);
  const callDeactivate = useRpc(beamDeactivate);
  const queryClient = useQueryClient();

  const statusKey = ["beam", "status", workspaceId];
  const statusQuery = useQuery({ queryKey: statusKey, queryFn: () => callStatus({}) });
  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: statusKey });

  const activateMutation = useMutation({
    mutationFn: () => {
      if (!workspace) {
        throw new Error("workspace directory is not available yet");
      }
      return callActivate({ workspaceId, workspaceDir: workspace.dir });
    },
    onSuccess: invalidateStatus,
  });
  const deactivateMutation = useMutation({
    mutationFn: () => callDeactivate({}),
    onSuccess: invalidateStatus,
  });

  const beam = statusQuery.data;
  const active = beam?.active ?? false;
  const pending =
    statusQuery.isLoading || activateMutation.isPending || deactivateMutation.isPending;
  const error = activateMutation.error ?? deactivateMutation.error ?? statusQuery.error;

  const restoreHint =
    active && beam?.mainPath && beam.originalHead
      ? `main is mirroring this workspace. To restore it: git -C ${beam.mainPath} reset --hard ${beam.originalHead} (was ${beam.originalBranch ?? "unknown"}).`
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
        fontSize: layout.compact ? 20 : 24,
        fontWeight: "600" as const,
      },
      state: { color: theme.colors.foregroundMuted, fontSize: 14 },
      warning: { color: theme.colors.statusWarning, fontSize: 13 },
      button: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.accent },
      buttonDisabled: { opacity: 0.5 },
      buttonText: {
        color: theme.colors.accentForeground,
        textAlign: "center" as const,
        fontSize: 16,
      },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

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
        style={pending ? [styles.button, styles.buttonDisabled] : styles.button}
      >
        <Text style={styles.buttonText}>{active ? "Beam out" : "Beam in"}</Text>
      </Pressable>
      {restoreHint ? <Text style={styles.warning}>{restoreHint}</Text> : null}
      {error ? (
        <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>
      ) : null}
    </View>
  );
}
