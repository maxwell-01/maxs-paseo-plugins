import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { type ReactNode, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Flow } from "../shared/flows.shared";
import { queueSummary } from "./diagram.client";
import { FlowDiagram } from "./flow-diagram.client";
import { useFlows } from "./flows-query.client";
import { Card, Chips, MONO, Notice, Pill, SectionTitle } from "./ui.client";

const ALL = "";

function Legend({ theme }: { theme: PluginTheme }) {
  const { colors } = theme;
  const swatch = (dashed: boolean, accent: boolean) => (
    <View style={{ width: 28, height: 12, borderRadius: 3, borderWidth: 1, borderStyle: dashed ? "dashed" : "solid",
      borderColor: accent ? colors.accent : colors.foregroundMuted }} />
  );
  const item = (key: string, mark: ReactNode, text: string) => (
    <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {mark}
      <Text style={{ color: colors.foreground, fontSize: 12 }}>{text}</Text>
    </View>
  );
  return (
    <Card theme={theme} style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {item("persistent", swatch(false, false), "persistent: one agent per ticket, keeps its context across rounds")}
      {item("fresh", swatch(true, false), "fresh: new agent every time, stays cold")}
      {item("gate", swatch(false, true), "gate: reviews an earlier stage")}
      {item("fail", <Text style={{ color: colors.statusDanger }}>↩</Text>, "FAIL loop-back")}
      {item("pass", null, "PASS with findings: carried to the next stage")}
    </Card>
  );
}

function FlowCard({ theme, flow, vertical }: { theme: PluginTheme; flow: Flow; vertical: boolean }) {
  const { colors } = theme;
  const ignored = flow.stages.filter((stage) => stage.ownerApproves || stage.asks);
  return (
    <Card theme={theme} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{flow.name}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 13, flex: 1 }}>{flow.remote ?? flow.repoDir}</Text>
        <Pill theme={theme}>max {flow.maxRounds} rounds</Pill>
        <Pill theme={theme}>stall {Math.round(flow.stallSeconds / 60)} min</Pill>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO }}>{flow.manifestPath}</Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{queueSummary(flow)}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        Any stage may BLOCK: it labels the issue <Text style={{ color: colors.statusWarning }}>blocked</Text>, comments the one question, and the run stops for the owner.
      </Text>
      <FlowDiagram theme={theme} flow={flow} vertical={vertical} />
      {ignored.length ? (
        <Notice theme={theme} tone="warning">
          * The manifest declares {ignored.map((stage) => [stage.ownerApproves && `${stage.id} owner_approves`, stage.asks && `${stage.id} asks ${stage.asks}`].filter(Boolean).join(", ")).join(", ")}. loop.py ignores both keys, so neither is enforced.
        </Notice>
      ) : null}
    </Card>
  );
}

export function WorkflowsTab({ theme, layout }: PluginSurfaceProps) {
  const flows = useFlows();
  const [repo, setRepo] = useState(ALL);
  if (flows.isPending) return <View style={{ padding: 24 }}><Notice theme={theme} tone="neutral">Reading manifests…</Notice></View>;
  if (flows.isError) return <View style={{ padding: 24 }}><Notice theme={theme} tone="danger">{flows.error.message}</Notice></View>;

  const { flows: all, problems } = flows.data;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 14 }}>
      <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8, justifyContent: "space-between" }}>
        <SectionTitle theme={theme}>Manifests</SectionTitle>
        <Chips theme={theme} value={repo} onChange={setRepo}
          options={[{ id: ALL, label: "All repos" }, ...all.map((flow) => ({ id: flow.name, label: flow.name }))]} />
      </View>
      {problems.map((problem) => <Notice key={problem} theme={theme} tone="warning">{problem}</Notice>)}
      <Legend theme={theme} />
      {all.filter((flow) => repo === ALL || flow.name === repo).map((flow) => (
        <FlowCard key={flow.repoDir} theme={theme} flow={flow} vertical={layout.compact} />
      ))}
    </ScrollView>
  );
}
