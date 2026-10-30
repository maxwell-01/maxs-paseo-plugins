import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SharedStackScreen } from "./client/shared-stack.client";

function SharedStackItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Layers" active={currentScreen?.screenId === "shared-stack"} onPress={() => openScreen({ screenId: "shared-stack" })} />;
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: "shared-stack", title: "Shared stack", Component: SharedStackScreen });
  const removeItem = client.addSidebarHeaderItem({ id: "shared-stack", title: "Shared stack", Component: SharedStackItem });
  const removeCommand = client.addCommandCenterItem({
    id: "open-shared-stack",
    title: "Open shared stack queue",
    icon: "Layers",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "shared-stack" });
    },
  });
  return () => {
    removeCommand();
    removeItem();
    removeScreen();
  };
}
