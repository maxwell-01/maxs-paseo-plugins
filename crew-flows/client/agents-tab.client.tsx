import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFlows } from "./flows-query.client";
import { groupRoles, modelLabel, type Role, type RoleVariant, stageEffects } from "./roles.client";
import { Card, Chips, Field, MONO, Notice, Pill, SectionTitle } from "./ui.client";

const ALL = "";

// By name, not by object: a refetch that changes a manifest must not orphan the selection.
type Selection = { flow: string; stage: string };

function VariantPills({ theme, variant }: { theme: PluginTheme; variant: RoleVariant }) {
  const { stage } = variant;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      <Pill theme={theme} dashed={!stage.persist}>{stage.persist ? "persistent" : "fresh"}</Pill>
      {stage.reviews ? <Pill theme={theme} tone="accent">gate on {stage.reviews}</Pill> : null}
      {stage.always ? <Pill theme={theme} tone="accent" dashed>always</Pill> : null}
      {stage.ownerApproves ? <Pill theme={theme} tone="warning">owner gate*</Pill> : null}
      {stage.brief?.ref.startsWith("skill:") ? <Pill theme={theme}>shared brief</Pill> : null}
    </View>
  );
}

function RoleCard({ theme, role, repoCount, selected, onSelect }: {
  theme: PluginTheme; role: Role; repoCount: number; selected: Selection | null; onSelect: (selection: Selection) => void;
}) {
  const { colors } = theme;
  return (
    <Card theme={theme}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{role.name}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO, flex: 1 }}>{role.id}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{role.variants.length} of {repoCount} repos</Text>
      </View>
      {role.blurb ? <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{role.blurb}</Text> : null}
      {role.variants.map((variant) => {
        const { flow, stage } = variant;
        const active = selected?.flow === flow.name && selected.stage === stage.id;
        return (
          <Pressable key={flow.name} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onSelect({ flow: flow.name, stage: stage.id })}
            style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 4, paddingLeft: active ? 8 : 0,
              borderLeftWidth: active ? 2 : 0, borderLeftColor: colors.accent }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{flow.name}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1 }}>{modelLabel(stage.model)} · {stage.thinking}</Text>
              <VariantPills theme={theme} variant={variant} />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{stage.brief?.outcome ?? "Brief not found."}</Text>
            {stage.brief ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO }}>{stage.brief.ref} · {stage.brief.words} words + craft.md</Text>
            ) : null}
          </Pressable>
        );
      })}
    </Card>
  );
}

function VariantDetail({ theme, variant, craftWords }: { theme: PluginTheme; variant: RoleVariant; craftWords: number | null }) {
  const { flow, stage } = variant;
  const effects = stageEffects(flow, stage);
  const briefPath = !stage.brief ? "not found" : stage.brief.ref.startsWith("skill:") ? stage.brief.ref : `.claude/${stage.brief.ref}`;
  return (
    <View style={{ gap: 8 }}>
      <Field theme={theme} label="Model" value={`${stage.model} · ${stage.thinking}`} />
      <Field theme={theme} label="Persistence" value={effects.persistence} />
      <Field theme={theme} label="On FAIL" value={effects.onFail} />
      <Field theme={theme} label="On PASS" value={effects.onPass} />
      <Field theme={theme} label="Brief" value={briefPath} mono />
      <Field theme={theme} label="Prepended" value={`craft.md${craftWords === null ? "" : ` (${craftWords} words)`}, shared by every repo`} />
      <Field theme={theme} label="Verdict" value={`${stage.id}-<round>.json`} mono />
      {stage.ownerApproves || stage.asks ? (
        <Notice theme={theme} tone="warning">
          * The manifest declares {[stage.ownerApproves && "owner_approves", stage.asks && `asks ${stage.asks}`].filter(Boolean).join(" and ")}; loop.py ignores both.
        </Notice>
      ) : null}
      <SectionTitle theme={theme}>Outcome</SectionTitle>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>{stage.brief?.outcome ?? "Brief not found."}</Text>
      {stage.brief?.checks.length ? (
        <>
          <SectionTitle theme={theme}>It tests for</SectionTitle>
          {stage.brief.checks.map((check) => (
            <Text key={check} style={{ color: theme.colors.foreground, fontSize: 13 }}>• {check}</Text>
          ))}
        </>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Read-only. Editing a brief stays a PR in the repo that owns it.</Text>
    </View>
  );
}

export function AgentsTab({ theme, layout }: PluginSurfaceProps) {
  const flows = useFlows();
  const [repo, setRepo] = useState(ALL);
  const [selection, setSelection] = useState<Selection | null>(null);
  if (flows.isPending) return <View style={{ padding: 24 }}><Notice theme={theme} tone="neutral">Reading manifests…</Notice></View>;
  if (flows.isError) return <View style={{ padding: 24 }}><Notice theme={theme} tone="danger">{flows.error.message}</Notice></View>;

  const { flows: all, craftWords, problems } = flows.data;
  const roles = groupRoles(all, repo === ALL ? null : repo);
  const selectedFlow = all.find((flow) => flow.name === selection?.flow);
  const selectedStage = selectedFlow?.stages.find((stage) => stage.id === selection?.stage);
  const selected = selectedFlow && selectedStage ? { flow: selectedFlow, stage: selectedStage } : null;
  const title = selected ? `${selected.flow.name} · ${selected.stage.id}` : "";
  const detail = selected ? <VariantDetail theme={theme} variant={selected} craftWords={craftWords} /> : null;
  const pad = layout.compact ? 16 : 24;
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: pad, gap: 12 }}>
        <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8, justifyContent: "space-between" }}>
          <SectionTitle theme={theme}>Agent definitions</SectionTitle>
          <Chips theme={theme} value={repo} onChange={setRepo}
            options={[{ id: ALL, label: "All repos" }, ...all.map((flow) => ({ id: flow.name, label: flow.name }))]} />
        </View>
        {problems.map((problem) => <Notice key={problem} theme={theme} tone="warning">{problem}</Notice>)}
        {all.length === 0 ? <Notice theme={theme} tone="neutral">No repo under /workspace has a ticket-loop manifest on origin/main.</Notice> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {roles.map((role) => (
            <View key={role.id} style={{ width: layout.compact ? "100%" : "48.5%" }}>
              <RoleCard theme={theme} role={role} repoCount={all.length} selected={selection} onSelect={setSelection} />
            </View>
          ))}
        </View>
      </ScrollView>
      {layout.compact ? (
        <Modal title={title} open={selected !== null} onOpenChange={(open) => { if (!open) setSelection(null); }}>
          <Modal.Content>{detail}</Modal.Content>
        </Modal>
      ) : (
        <ScrollView style={{ width: 360, flexGrow: 0, borderLeftWidth: 1, borderColor: theme.colors.border }} contentContainerStyle={{ padding: pad, gap: 12 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{title || "Select an agent"}</Text>
          {detail ?? <Notice theme={theme} tone="neutral">Pick a repo's stage to see how the loop runs it.</Notice>}
        </ScrollView>
      )}
    </View>
  );
}
