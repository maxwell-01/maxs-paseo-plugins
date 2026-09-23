import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  applyBeamingTitle,
  readWorkspaceTitle,
  restoreWorkspaceTitle,
} from "./server/beam-title.server";
import { activate, deactivate, getBeamLog, logBeam, status, stopAllBeams } from "./server/beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

function reportMarkingFailure(action: string, error: unknown): void {
  logBeam("warn", `${action}: ${error instanceof Error ? error.message : String(error)}`);
}

async function markingFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    reportMarkingFailure(action, error);
  }
}

export default function contribute(server: PluginServerContext) {
  server.handle(beamActivate, async (input, { paseo }) => {
    const workspace = await readWorkspaceTitle(paseo, input.workspaceId).catch((error) => {
      reportMarkingFailure("could not read the workspace title", error);
      return null;
    });
    const result = await activate({ ...input, workspaceTitle: workspace?.title });
    if (workspace) {
      await markingFailure("could not mark the workspace as beaming", () =>
        applyBeamingTitle(paseo, input.workspaceId, workspace.title, workspace.name),
      );
    }
    return result;
  });
  server.handle(beamDeactivate, async (_input, { paseo }) => {
    const { workspaceId, originalTitle } = await deactivate();
    await markingFailure(
      `could not restore the workspace title to ${originalTitle ?? "none"}`,
      () => restoreWorkspaceTitle(paseo, workspaceId, originalTitle),
    );
    return { active: false as const };
  });
  server.handle(beamStatus, status);
  server.handle(beamLog, () => ({ entries: getBeamLog() }));

  return () => {
    stopAllBeams();
  };
}
