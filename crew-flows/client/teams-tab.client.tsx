import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { listTeams, type Run } from "../shared/teams.shared";
import { ActionButton, AgentActions } from "./agent-actions.client";
import { readStateLine } from "./crew.client";
import { CrewList } from "./crew-section.client";
import { useFlows } from "./flows-query.client";
import { modelLabel } from "./roles.client";
import { runStages, runState, type StageCell } from "./teams.client";
import { triage } from "./triage.client";
import { Card, Disclosure, MONO, Notice, Pill, SectionTitle, type Tone, toneColor } from "./ui.client";

const REFRESH_MS = 5_000;

function clock(iso: string | null): string {
  if (!iso) return "?";
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function cellTone(cell: StageCell): Tone {
  if (cell.current) return "accent";
  if (!cell.verdict) return "neutral";
  return cell.verdict.verdict === "PASS" ? "success" : cell.verdict.verdict === "BLOCK" ? "warning" : "danger";
}

function StageStrip({ theme, cells }: { theme: PluginTheme; cells: StageCell[] }) {
  const { colors } = theme;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {cells.map((cell) => {
        const tone = cellTone(cell);
        const reached = cell.current || cell.verdict !== null;
        return (
          <View key={cell.id} style={{ minWidth: 104, flexGrow: 1, flexBasis: 0, borderWidth: 1, borderRadius: 8, padding: 8, gap: 2,
            borderStyle: cell.persist ? "solid" : "dashed", borderColor: reached ? toneColor(theme, tone) : colors.border, opacity: reached ? 1 : 0.6 }}>
            <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{cell.id}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{modelLabel(cell.model)}{cell.agent ? ` · ${cell.agent.status}` : ""}</Text>
            {cell.verdict ? (
              <Text style={{ color: toneColor(theme, tone), fontSize: 11 }}>
                r{cell.verdict.round} {cell.verdict.verdict}{cell.verdict.findings ? ` · ${cell.verdict.findings} findings` : ""}
              </Text>
            ) : null}
            {cell.current ? <Text style={{ color: colors.accent, fontSize: 11 }}>running</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function runStatus(run: Run, now: number): string {
  const state = runState(run, now);
  if (state === "live") return `${run.stage} · round ${run.round}`;
  return state === "ended" ? `${run.outcome} · ended ${clock(run.beaconAt)}` : `stopped · no beacon since ${clock(run.beaconAt)}`;
}

function RunCard({ theme, run, cells, now, navigation }: {
  theme: PluginTheme; run: Run; cells: StageCell[]; now: number; navigation: PluginSurfaceProps["navigation"];
}) {
  const { colors } = theme;
  const [showLog, setShowLog] = useState(false);
  const state = runState(run, now);
  const speaker = cells.find((cell) => cell.current)?.agent ?? [...cells].reverse().find((cell) => cell.agent)?.agent ?? null;
  return (
    <Card theme={theme} selected={state === "live"}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", flex: 1 }}>{run.name}{run.issue ? ` #${run.issue}` : ""}</Text>
        <Pill theme={theme} tone={state === "live" ? "accent" : state === "ended" && run.outcome === "PASS" ? "success" : "warning"}>{runStatus(run, now)}</Pill>
      </View>
      <StageStrip theme={theme} cells={cells} />
      {speaker?.lastSaid ? (
        <View style={{ borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 10, gap: 2 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{speaker.labels["crew-flows.stage"] ?? speaker.title}</Text>
          <Text selectable numberOfLines={4} style={{ color: colors.foreground, fontSize: 13 }}>{speaker.lastSaid}</Text>
        </View>
      ) : null}
      {state !== "live" ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {state === "ended" ? `Run ended at ${clock(run.beaconAt)}.` : "The engine stopped without writing an outcome."} Its agents are deleted at teardown; what is left is in{" "}
          <Text style={{ fontFamily: MONO }}>{run.stateDir}</Text>.
        </Text>
      ) : null}
      {speaker ? <AgentActions key={speaker.id} theme={theme} agentId={speaker.id} navigation={navigation}
        openLabel={`Open ${speaker.labels["crew-flows.stage"] ?? "agent"} in Paseo`} /> : null}
      {run.logTail ? (
        <View style={{ flexDirection: "row" }}>
          <ActionButton theme={theme} label={showLog ? "Hide run log" : "Run log"} onPress={() => setShowLog(!showLog)} />
        </View>
      ) : null}
      {showLog && run.logTail ? <Text selectable style={{ color: colors.foregroundMuted, fontFamily: MONO, fontSize: 11 }}>{run.logTail.join("\n")}</Text> : null}
    </Card>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function TeamsTab({ theme, layout, navigation }: PluginSurfaceProps) {
  const list = useRpc(listTeams);
  const teams = useQuery({ queryKey: ["crew-flows", "teams"], queryFn: () => list({}), refetchInterval: REFRESH_MS });
  const flows = useFlows();
  if (teams.isPending) return <View style={{ padding: 24 }}><Notice theme={theme} tone="neutral">Reading runs…</Notice></View>;
  if (teams.isError) return <View style={{ padding: 24 }}><Notice theme={theme} tone="danger">{teams.error.message}</Notice></View>;

  const now = Date.now();
  const { runs, agents } = teams.data;
  const problems = [...teams.data.problems, ...(flows.isError ? [flows.error.message] : [])];
  const { mate, crew, needsYou, running, doneOrIdle, liveRuns, recentRuns } = triage(agents, runs, now);
  const runCard = (run: Run) => (
    <RunCard key={run.stateDir} theme={theme} run={run} now={now} navigation={navigation}
      cells={runStages(run, flows.data?.flows ?? [], agents, now)} />
  );
  const quiet = needsYou.length === 0 && running.length === 0 && liveRuns.length === 0;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 14 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
        <Text style={{ color: needsYou.length ? theme.colors.statusWarning : theme.colors.foregroundMuted }}>{needsYou.length} need you</Text>
        {` · ${running.length} running · ${plural(liveRuns.length, "run", "runs")} live · ${doneOrIdle.length} done or idle`}
      </Text>
      {quiet ? (
        <Notice theme={theme} tone={problems.length ? "warning" : "neutral"}>
          {problems.length ? "Nothing found, but this host could not be read in full. The problems are at the end." : "Nothing needs you and nothing is running."}
        </Notice>
      ) : null}
      {needsYou.length ? (
        <>
          <SectionTitle theme={theme}>Needs you</SectionTitle>
          <CrewList theme={theme} members={needsYou} allOpen navigation={navigation} />
        </>
      ) : null}
      {liveRuns.length || running.length ? (
        <>
          <SectionTitle theme={theme}>Running now</SectionTitle>
          {liveRuns.map(runCard)}
          {running.length ? <CrewList theme={theme} members={running} navigation={navigation} /> : null}
        </>
      ) : null}
      {recentRuns.length ? (
        <>
          <SectionTitle theme={theme}>Recent runs</SectionTitle>
          {recentRuns.map((run) => (
            <Disclosure key={run.stateDir} theme={theme} title={`${run.name}${run.issue ? ` #${run.issue}` : ""} · ${runStatus(run, now)}`}>
              {runCard(run)}
            </Disclosure>
          ))}
        </>
      ) : null}
      {doneOrIdle.length ? (
        <Disclosure theme={theme} title={`Done and idle (${doneOrIdle.length})`}>
          <CrewList theme={theme} members={doneOrIdle} navigation={navigation} />
        </Disclosure>
      ) : null}
      {mate ? (
        <Disclosure theme={theme} title={`First mate · ${mate.status} · ${plural(crew.length, "crewmate", "crewmates")}`}>
          <CrewList theme={theme} members={[readStateLine(mate)]} navigation={navigation} />
        </Disclosure>
      ) : null}
      {problems.length ? (
        <Disclosure theme={theme} title={`${plural(problems.length, "problem", "problems")} reading this host`}>
          {problems.map((problem) => <Notice key={problem} theme={theme} tone="warning">{problem}</Notice>)}
        </Disclosure>
      ) : null}
    </ScrollView>
  );
}
