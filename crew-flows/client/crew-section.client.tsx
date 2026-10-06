import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LiveAgent } from "../shared/teams.shared";
import { AgentActions } from "./agent-actions.client";
import type { Crewmate } from "./crew.client";
import { Card, Notice, Pill, SectionTitle, type Tone } from "./ui.client";

const STATE_TONES: Record<string, Tone> = {
  working: "accent", "needs-decision": "warning", blocked: "warning", paused: "neutral",
  done: "success", resolved: "success", failed: "danger",
};

function Row({ theme, agent, pills, line, open, onToggle, navigation }: {
  theme: PluginTheme; agent: LiveAgent; pills: { text: string; tone: Tone }[]; line: string | null;
  open: boolean; onToggle: () => void; navigation: PluginSurfaceProps["navigation"];
}) {
  const { colors } = theme;
  return (
    <View style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}>
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

export function CrewSection({ theme, mate, crew, navigation }: {
  theme: PluginTheme; mate: LiveAgent | null; crew: Crewmate[]; navigation: PluginSurfaceProps["navigation"];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => () => setOpenId(openId === id ? null : id);
  return (
    <>
      <SectionTitle theme={theme}>FirstMate crew</SectionTitle>
      <Card theme={theme} style={{ gap: 0 }}>
        {mate ? (
          <Row theme={theme} agent={mate} navigation={navigation} open={openId === mate.id} onToggle={toggle(mate.id)}
            pills={[{ text: "first mate", tone: "neutral" }, { text: mate.status, tone: mate.status === "running" ? "accent" : "neutral" }]}
            line={`${crew.length} crewmates`} />
        ) : <Notice theme={theme} tone="neutral">No first mate on this host.</Notice>}
        {crew.map(({ agent, state, line }) => (
          <Row key={agent.id} theme={theme} agent={agent} navigation={navigation} line={line}
            open={openId === agent.id} onToggle={toggle(agent.id)}
            pills={[
              ...(state ? [{ text: state, tone: STATE_TONES[state] ?? "neutral" }] : [{ text: agent.status, tone: "neutral" as const }]),
              ...(agent.labels["firstmate.kind"] ? [{ text: agent.labels["firstmate.kind"], tone: "neutral" as const }] : []),
            ]} />
        ))}
      </Card>
    </>
  );
}
