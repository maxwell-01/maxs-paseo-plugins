import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CrewFlowsScreen } from "./client/screen.client";

const SURFACE = "crew-flows";

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface(SURFACE, CrewFlowsScreen);
  const removeSidebarItem = client.addSidebarItem({ id: SURFACE, title: "Crew & Flows", icon: "Workflow", surface: SURFACE });
  const removeCommand = client.addCommandCenterItem({
    id: "open-crew-flows",
    title: "Open Crew & Flows",
    icon: "Workflow",
    context: "global",
    onSelect: ({ openSurface }) => openSurface(SURFACE),
  });
  return () => {
    removeCommand();
    removeSidebarItem();
    removeSurface();
  };
}
