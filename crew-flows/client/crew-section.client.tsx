import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LiveAgent } from "../shared/teams.shared";
import { AgentActions } from "./agent-actions.client";
import type { Crewmate } from "./crew.client";
import { Card, Pill, type Tone } from "./ui.client";

const STATE_TONES: Record<string, Tone> = {
  working: "accent", "needs-decision": "warning", blocked: "warning", paused: "neutral",
  done: "success", resolved: "success", failed: "danger",
};

function Row({ theme, agent, pills, line, open, divided, onToggle, navigation }: {
  theme: PluginTheme; agent: LiveAgent; pills: { text: string; tone: Tone }[]; line: string | null;
  open: boolean; divided: boolean; onToggle: () => void; navigation: PluginSurfaceProps["navigation"];
}) {
  const { colors } = theme;
  return (
    <View style={{ gap: 8, paddingVertical: 8, borderTopWidth: divided ? 1 : 0, borderColor: colors.border }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>{agent.title ?? agent.id}</Text>
          {pills.map((pill) => <Pill key={pill.text} theme={theme} tone={pill.tone}>{pill.text}</Pill>)}
        </View>
        {line ? <Text numberOfLines={open ? undefined : 2} style={{ color: colors.foregroundMuted, fontSize: 13 }}>{line}</Text> : null}
      </Pressable>
      {open ? <AgentActions theme={theme} agentId={agent.id} openLabel="Open in Paseo" navigation={navigation} /> : null}
    </View>
  );
}

function crewPills({ agent, state }: Crewmate): { text: string; tone: Tone }[] {
  return [
    state ? { text: state, tone: STATE_TONES[state] ?? "neutral" } : { text: agent.status, tone: agent.status === "running" ? "accent" : "neutral" },
    ...(agent.labels["firstmate.kind"] ? [{ text: agent.labels["firstmate.kind"], tone: "neutral" as const }] : []),
  ];
}

export function CrewList({ theme, members, allOpen = false, navigation }: {
  theme: PluginTheme; members: Crewmate[]; allOpen?: boolean; navigation: PluginSurfaceProps["navigation"];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card theme={theme} style={{ gap: 0 }}>
      {members.map((member, index) => {
        const open = allOpen || openId === member.agent.id;
        return (
          <Row key={member.agent.id} theme={theme} agent={member.agent} navigation={navigation} line={member.line}
            open={open} divided={index > 0} onToggle={() => setOpenId(open ? null : member.agent.id)} pills={crewPills(member)} />
        );
      })}
    </Card>
  );
}
