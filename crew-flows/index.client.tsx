import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CrewFlowsScreen } from "./client/screen.client";
import { SourcesSettingsScreen } from "./client/settings-screen.client";

const SURFACE = "crew-flows";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({ id: "sources", title: "Crew & Flows", icon: "FolderSearch", Component: SourcesSettingsScreen });
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
    removeSettings();
  };
}
