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

  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") {
      addButton(update.workspace.id);
    }
  });

  client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      for (const workspace of result.entries) {
        addButton(workspace.id);
      }
    })
    .catch((error) => {
      console.error(
        "beam: failed to list workspaces for header buttons:",
        error instanceof Error ? error.message : error,
      );
    });

  const interval = setInterval(() => {
    client
      .rpc(beamStatus, {})
      .then((status) => {
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
      })
      .catch(() => {
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
  };
}
