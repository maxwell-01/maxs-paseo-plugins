import type { PaseoApi } from "@getpaseo/client";
import { beamingTitle } from "../shared/beam.shared";

export async function readWorkspaceTitle(
  paseo: PaseoApi,
  workspaceId: string,
): Promise<{ title: string | null; name: string }> {
  const handle = paseo.workspaces.ref(workspaceId);
  if (!handle.current()) {
    await handle.refresh();
  }
  const workspace = handle.current();
  return { title: workspace?.title ?? null, name: workspace?.name ?? workspaceId };
}

export async function applyBeamingTitle(
  paseo: PaseoApi,
  workspaceId: string,
  originalTitle: string | null,
  workspaceName: string,
): Promise<void> {
  await paseo.workspaces.ref(workspaceId).setTitle(beamingTitle(originalTitle, workspaceName));
}

export async function restoreWorkspaceTitle(
  paseo: PaseoApi,
  workspaceId: string | undefined,
  originalTitle: string | null | undefined,
): Promise<void> {
  if (!workspaceId || originalTitle === undefined) {
    return;
  }
  await paseo.workspaces.ref(workspaceId).setTitle(originalTitle);
}
