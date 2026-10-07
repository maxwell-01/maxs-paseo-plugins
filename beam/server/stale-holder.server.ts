import { existsSync } from "node:fs";
import { beamOut } from "./beam-rpc.server";
import type { WorkspaceTitleHandle, WorkspaceTitlePort } from "./beam-title.server";
import { type BeamHolder, logBeam, readHolder } from "./beam.server";

export interface StaleHolderPort {
  workspaces: {
    ref(
      workspaceId: string,
    ): Omit<WorkspaceTitleHandle, "refresh"> & {
      refresh(): Promise<{ archivingAt: string | null } | null>;
    };
  };
}

export async function findStaleReason(
  port: StaleHolderPort,
  holder: BeamHolder,
): Promise<string | null> {
  if (!existsSync(holder.workspaceDir)) {
    return "its directory no longer exists";
  }
  const workspace = await port.workspaces.ref(holder.workspaceId).refresh();
  if (!workspace) {
    return "its workspace is no longer listed";
  }
  return workspace.archivingAt ? "its workspace is being archived" : null;
}

async function releaseIfStillHolder(
  port: WorkspaceTitlePort,
  holder: BeamHolder,
  reason: string,
): Promise<void> {
  const current = readHolder();
  if (current?.workspaceId !== holder.workspaceId || current.startedAt !== holder.startedAt) {
    return;
  }
  await beamOut(port);
  logBeam("warn", `released beam of "${holder.workspaceName ?? holder.workspaceId}": ${reason}`);
}

export async function releaseStaleHolder(port: StaleHolderPort): Promise<void> {
  const holder = readHolder();
  if (!holder) {
    return;
  }
  const reason = await findStaleReason(port, holder);
  if (reason) {
    await releaseIfStillHolder(port, holder, reason);
  }
}

interface WorkspaceArchivedSource {
  on(
    name: "workspace.archived",
    handler: (
      event: { workspace: { id: string } },
      context: { paseo: StaleHolderPort },
    ) => Promise<void>,
  ): unknown;
}

export function registerStaleHolderRelease(server: WorkspaceArchivedSource): void {
  server.on("workspace.archived", async ({ workspace }, { paseo }) => {
    const holder = readHolder();
    if (holder?.workspaceId === workspace.id) {
      await releaseIfStillHolder(paseo, holder, "its workspace was archived");
    }
  });
}
