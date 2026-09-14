import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerBeamHeaderButtons } from "./client/beam-header.client";
import { BeamPanel } from "./client/beam.client";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "beam",
    title: "Beam",
    icon: "Zap",
    context: "workspace",
    Component: BeamPanel,
  });
  client.addCommandCenterItem({
    id: "open-beam",
    title: "Open Beam",
    icon: "Zap",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("beam");
    },
  });

  const cleanupHeaderButtons = registerBeamHeaderButtons(client);

  return () => {
    cleanupHeaderButtons();
  };
}
