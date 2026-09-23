import type { PluginServerContext } from "@getpaseo/plugin/server";
import { activateWithTitleMark, deactivateWithTitleMark } from "./server/beam-rpc.server";
import { getBeamLog, status, stopAllBeams } from "./server/beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

export default function contribute(server: PluginServerContext) {
  server.handle(beamActivate, (input, { paseo }) => activateWithTitleMark(paseo, input));
  server.handle(beamDeactivate, (_input, { paseo }) => deactivateWithTitleMark(paseo));
  server.handle(beamStatus, status);
  server.handle(beamLog, () => ({ entries: getBeamLog() }));

  return () => {
    stopAllBeams();
  };
}
