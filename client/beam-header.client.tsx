import type { PluginCleanup } from "@getpaseo/plugin";
import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { beamActivate, beamDeactivate, beamStatus } from "../shared/beam.shared";

const POLL_INTERVAL_MS = 1000;

function BeamHeaderIconActive({ theme, size }: PluginButtonIconProps) {
  return <Icon name="Zap" size={size} color={theme.colors.statusWarning} />;
}

function BeamHeaderIconIdle({ size, color }: PluginButtonIconProps) {
  return <Icon name="Zap" size={size} color={color} />;
}

async function toggleBeam(client: PluginClientContext, workspaceId: string): Promise<void> {
  const current = await client.rpc(beamStatus, {});
  if (current.active && current.workspaceId === workspaceId) {
    await client.rpc(beamDeactivate, {});
    return;
  }
  if (current.active && current.workspaceId !== workspaceId) {
    throw new Error(
      `Already beaming "${current.workspaceName ?? "another workspace"}"; beam out there first`,
    );
  }
  const handle = client.paseo.workspaces.ref(workspaceId);
  let workspaceDir = handle.directory;
  let workspaceName = handle.name;
  if (!workspaceDir || !workspaceName) {
    await handle.refresh();
    workspaceDir = handle.directory;
    workspaceName = handle.name;
  }
  if (!workspaceDir) {
    throw new Error(`beam: could not resolve directory for workspace ${workspaceId}`);
  }
  await client.rpc(beamActivate, {
    workspaceId,
    workspaceName: workspaceName ?? workspaceId,
    workspaceDir,
  });
}

type BeamButtonState = "mine" | "other" | "idle";

function presentation(state: BeamButtonState, otherName: string) {
  if (state === "mine") {
    return { icon: BeamHeaderIconActive, title: "Mirroring into main — click to stop" };
  }
  if (state === "other") {
    return { icon: BeamHeaderIconIdle, title: `Beaming "${otherName}" — beam out there first` };
  }
  return { icon: BeamHeaderIconIdle, title: "Mirror this workspace into your main checkout" };
}

export function registerBeamHeaderButtons(client: PluginClientContext): PluginCleanup {
  const buttons = new Map<string, { reg: PluginButtonRegistration; lastKey: string }>();
  const agentsByWorkspace = new Map<string, Set<string>>();
  const workspaceByAgent = new Map<string, string>();

  const addButton = (workspaceId: string) => {
    if (buttons.has(workspaceId)) {
      return;
    }
    const reg = client.addHeaderButton({
      id: `beam-${workspaceId}`,
      workspaceId,
      button: {
        title: "Mirror this workspace into your main checkout",
        icon: BeamHeaderIconIdle,
        behavior: { kind: "action", onPress: () => toggleBeam(client, workspaceId) },
      },
    });
    buttons.set(workspaceId, { reg, lastKey: "idle" });
  };

  const removeButton = (workspaceId: string) => {
    const entry = buttons.get(workspaceId);
    if (entry) {
      entry.reg.remove();
      buttons.delete(workspaceId);
    }
  };

  // Header buttons need a workspaceId, and the client can enumerate AGENTS (not workspaces).
  // Discover each open workspace through its agents, ref-counting agents per workspace so one
  // button is registered per workspace and removed when its last agent goes away.
  const addAgent = (agent: { id: string; workspaceId?: string }) => {
    const { id: agentId, workspaceId } = agent;
    if (!workspaceId || workspaceByAgent.has(agentId)) {
      return;
    }
    workspaceByAgent.set(agentId, workspaceId);
    let agentIds = agentsByWorkspace.get(workspaceId);
    if (!agentIds) {
      agentIds = new Set();
      agentsByWorkspace.set(workspaceId, agentIds);
    }
    agentIds.add(agentId);
    addButton(workspaceId);
  };

  const removeAgent = (agentId: string) => {
    const workspaceId = workspaceByAgent.get(agentId);
    if (!workspaceId) {
      return;
    }
    workspaceByAgent.delete(agentId);
    const agentIds = agentsByWorkspace.get(workspaceId);
    if (agentIds) {
      agentIds.delete(agentId);
      if (agentIds.size === 0) {
        agentsByWorkspace.delete(workspaceId);
        removeButton(workspaceId);
      }
    }
  };

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") {
      addAgent(update.agent);
    } else if (update.kind === "remove") {
      removeAgent(update.agentId);
    }
  });

  client.paseo.agents
    .list({ subscribe: {} })
    .then((result) => {
      for (const entry of result.entries) {
        addAgent(entry.agent);
      }
    })
    .catch((error) => {
      console.error(
        "beam: failed to list agents for header buttons:",
        error instanceof Error ? error.message : error,
      );
    });

  const refreshButtons = async () => {
    const status = await client.rpc(beamStatus, {});
    const otherName = status.workspaceName ?? "another workspace";
    for (const [workspaceId, entry] of buttons) {
      const state: BeamButtonState =
        status.active && status.workspaceId === workspaceId
          ? "mine"
          : status.active
            ? "other"
            : "idle";
      const key = state === "other" ? `other:${otherName}` : state;
      if (key !== entry.lastKey) {
        entry.reg.update(presentation(state, otherName));
        entry.lastKey = key;
      }
    }
  };

  const interval = setInterval(() => {
    refreshButtons().catch(() => {
      // transient poll failure; keep the last presentation
    });
  }, POLL_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    unsubscribe();
    for (const { reg } of buttons.values()) {
      reg.remove();
    }
    buttons.clear();
    agentsByWorkspace.clear();
    workspaceByAgent.clear();
  };
}
