import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { type ComponentType, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AgentsTab } from "./agents-tab.client";
import { WorkflowsTab } from "./workflows-tab.client";

const TABS: { id: string; label: string; Component: ComponentType<PluginSurfaceProps> }[] = [
  { id: "workflows", label: "Workflows", Component: WorkflowsTab },
  { id: "agents", label: "Agents", Component: AgentsTab },
];

export function CrewFlowsScreen(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const [tabId, setTabId] = useState(TABS[0].id);
  const Active = (TABS.find((tab) => tab.id === tabId) ?? TABS[0]).Component;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, paddingHorizontal: layout.compact ? 16 : 24, paddingVertical: 10,
        borderBottomWidth: 1, borderColor: theme.colors.border }}>
        {TABS.map((tab) => {
          const active = tab.id === tabId;
          return (
            <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setTabId(tab.id)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: active ? theme.colors.surface2 : "transparent" }}>
              <Text style={{ color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 14 }}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Active {...props} />
    </View>
  );
}
