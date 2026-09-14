import type { PluginContext } from "@getpaseo/plugin";
import { BeamPanel } from "./beam.client";
import { activate, deactivate, getBeamLog, status, stopAllBeams } from "./beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./beam.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(beamActivate, (input) => activate(input));
  plugin.handle(beamDeactivate, () => deactivate());
  plugin.handle(beamStatus, () => status());
  plugin.handle(beamLog, () => ({ entries: getBeamLog() }));

  plugin.addWorkspacePanel({
    id: "beam",
    title: "Beam",
    icon: "Zap",
    context: "workspace",
    Component: BeamPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-beam",
    title: "Open Beam",
    icon: "Zap",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("beam");
    },
  });

  return () => {
    stopAllBeams();
  };
}
