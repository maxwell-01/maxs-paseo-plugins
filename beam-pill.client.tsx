import {
  type PluginCleanup,
  type PluginClientContext,
  type PluginComposerPillProps,
  useRpc,
} from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { beamActivate, beamDeactivate, beamStatus } from "./beam.shared";

const POLL_INTERVAL_MS = 1000;

export function BeamPill({ theme, workspaceId }: PluginComposerPillProps) {
  const callStatus = useRpc(beamStatus);
  const statusQuery = useQuery({
    queryKey: ["beam", "pill-status", workspaceId],
    queryFn: () => callStatus({}),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const active = statusQuery.data?.active ?? false;
  const [hovered, setHovered] = useState(false);
  const tooltip = active
    ? "Mirroring into main — click to restore"
    : "Mirror this workspace into your main checkout";

  const styles = useMemo(
    () => ({
      container: {
        position: "relative" as const,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        cursor: "pointer" as const,
      },
      label: { fontSize: 13, fontWeight: "600" as const, color: theme.colors.foreground },
      labelActive: { color: theme.colors.statusWarning },
      labelError: { color: theme.colors.statusDanger },
      tooltip: {
        position: "absolute" as const,
        bottom: "100%" as const,
        left: 0,
        marginBottom: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      tooltipText: { color: theme.colors.foreground, fontSize: 12 },
    }),
    [theme],
  );

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={tooltip}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={styles.container}
    >
      <Text
        style={[
          styles.label,
          active ? styles.labelActive : null,
          statusQuery.isError ? styles.labelError : null,
        ]}
      >
        {active ? "⚡ Beaming" : "Beam"}
      </Text>
      {hovered ? (
        <View pointerEvents="none" style={styles.tooltip}>
          <Text numberOfLines={1} style={styles.tooltipText}>
            {tooltip}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

async function toggleBeam(
  client: PluginClientContext,
  workspaceId: string,
): Promise<void> {
  const current = await client.rpc(beamStatus, {});
  if (current.active) {
    await client.rpc(beamDeactivate, {});
    return;
  }
  const handle = client.paseo.workspaces.ref(workspaceId);
  let workspaceDir = handle.directory;
  if (!workspaceDir) {
    await handle.refresh();
    workspaceDir = handle.directory;
  }
  if (!workspaceDir) {
    throw new Error(`beam: could not resolve directory for workspace ${workspaceId}`);
  }
  await client.rpc(beamActivate, { workspaceId, workspaceDir });
}

export function registerBeamPills(client: PluginClientContext): PluginCleanup {
  const pillCleanups = new Map<string, PluginCleanup>();

  const addPill = (agent: { id: string; workspaceId?: string }) => {
    const { id: agentId, workspaceId } = agent;
    if (!workspaceId || pillCleanups.has(agentId)) {
      return;
    }
    const cleanup = client.addComposerPill({
      id: `beam-${agentId}`,
      title: "Beam",
      workspaceId,
      agentId,
      Component: BeamPill,
      onPress: () => toggleBeam(client, workspaceId),
    });
    pillCleanups.set(agentId, cleanup);
  };

  const removePill = (agentId: string) => {
    const cleanup = pillCleanups.get(agentId);
    if (cleanup) {
      cleanup();
      pillCleanups.delete(agentId);
    }
  };

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") {
      addPill(update.agent);
    } else if (update.kind === "remove") {
      removePill(update.agentId);
    }
  });

  client.paseo.agents
    .list({ subscribe: {} })
    .then((result) => {
      for (const entry of result.entries) {
        addPill(entry.agent);
      }
    })
    .catch((error) => {
      console.error(
        "beam: failed to list agents for composer pills:",
        error instanceof Error ? error.message : error,
      );
    });

  return () => {
    unsubscribe();
    for (const cleanup of pillCleanups.values()) {
      cleanup();
    }
    pillCleanups.clear();
  };
}
