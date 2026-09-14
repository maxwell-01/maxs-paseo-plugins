import {
  type PluginCleanup,
  type PluginClientContext,
  type PluginComposerPillProps,
  useRpc,
} from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { beamActivate, beamDeactivate, beamStatus } from "./beam.shared";

const POLL_INTERVAL_MS = 1000;
const ACTIVE_TEXT_COLOR = "#1A1A1A";

export function BeamPill({ theme, workspaceId }: PluginComposerPillProps) {
  const callStatus = useRpc(beamStatus);
  const statusQuery = useQuery({
    queryKey: ["beam", "pill-status", workspaceId],
    queryFn: () => callStatus({}),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const active = statusQuery.data?.active ?? false;

  const styles = useMemo(
    () => ({
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
      },
      pillActive: {
        backgroundColor: theme.colors.statusWarning,
        borderColor: theme.colors.statusWarning,
      },
      pillInactive: {
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
      },
      pillError: { borderColor: theme.colors.statusDanger },
      textActive: { color: ACTIVE_TEXT_COLOR, fontSize: 13, fontWeight: "600" as const },
      textInactive: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
    }),
    [theme],
  );

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={
        active ? "Beam active, click to beam out" : "Beam inactive, click to beam in"
      }
      style={[
        styles.pill,
        active ? styles.pillActive : styles.pillInactive,
        statusQuery.isError ? styles.pillError : null,
      ]}
    >
      <Text style={active ? styles.textActive : styles.textInactive}>⚡ Beam</Text>
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
