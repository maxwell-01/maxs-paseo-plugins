import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { BeamPanel } from "./beam.client";
import { activate, deactivate, status, stopAllBeams } from "./beam.server";
import { beamActivate, beamDeactivate, beamStatus } from "./beam.shared";

type PluginContext = PluginClientContext & PluginServerContext;

export default function contribute(plugin: PluginContext) {
  plugin.handle(beamActivate, (input) => activate(input));
  plugin.handle(beamDeactivate, () => deactivate());
  plugin.handle(beamStatus, () => status());

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
