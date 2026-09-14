import type { PluginServerContext } from "@getpaseo/plugin/server";
import { activate, deactivate, getBeamLog, status, stopAllBeams } from "./server/beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

export default function contribute(server: PluginServerContext) {
  server.handle(beamActivate, activate);
  server.handle(beamDeactivate, deactivate);
  server.handle(beamStatus, status);
  server.handle(beamLog, () => ({ entries: getBeamLog() }));

  return () => {
    stopAllBeams();
  };
}
