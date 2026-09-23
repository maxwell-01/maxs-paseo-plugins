import {
  applyBeamingTitle,
  readWorkspaceTitle,
  restoreWorkspaceTitle,
  type WorkspaceTitlePort,
} from "./beam-title.server";
import { activate, deactivate, logBeamWarning } from "./beam.server";

export async function beamIn(
  port: WorkspaceTitlePort,
  input: { workspaceId: string; workspaceName: string; workspaceDir: string },
): Promise<{ active: true; mainPath: string }> {
  const titleMark = await readWorkspaceTitle(port, input.workspaceId).catch((error: unknown) => {
    logBeamWarning("could not read the workspace title", error);
    return undefined;
  });
  const result = await activate({ ...input, titleMark });
  if (titleMark) {
    await applyBeamingTitle(port, input.workspaceId, titleMark).catch((error: unknown) =>
      logBeamWarning("could not mark the workspace as beaming", error),
    );
  }
  return result;
}

export async function beamOut(port: WorkspaceTitlePort): Promise<{ active: false }> {
  const { workspaceId, titleMark } = await deactivate();
  if (workspaceId) {
    await restoreWorkspaceTitle(port, workspaceId, titleMark).catch((error: unknown) =>
      logBeamWarning(
        `could not restore the workspace title to ${titleMark?.originalTitle ?? "none"}`,
        error,
      ),
    );
  }
  return { active: false };
}
