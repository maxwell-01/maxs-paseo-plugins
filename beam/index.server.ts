import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyBeamingTitle, readWorkspaceTitle, restoreWorkspaceTitle } from "./server/beam-title.server";
import { activate, deactivate, getBeamLog, status, stopAllBeams } from "./server/beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

export default function contribute(server: PluginServerContext) {
  server.handle(beamActivate, async (input, { paseo }) => {
    const { title, name } = await readWorkspaceTitle(paseo, input.workspaceId);
    const result = await activate({ ...input, workspaceTitle: title });
    await applyBeamingTitle(paseo, input.workspaceId, title, name);
    return result;
  });
  server.handle(beamDeactivate, async (_input, { paseo }) => {
    const { workspaceId, originalTitle } = await deactivate();
    await restoreWorkspaceTitle(paseo, workspaceId, originalTitle);
    return { active: false as const };
  });
  server.handle(beamStatus, status);
  server.handle(beamLog, () => ({ entries: getBeamLog() }));

  return () => {
    stopAllBeams();
  };
}
