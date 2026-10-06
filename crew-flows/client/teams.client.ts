import type { Flow } from "../shared/flows.shared";
import type { LiveAgent, Run } from "../shared/teams.shared";

// The beacon rewrites itself every 30 s; three missed beats means the engine is gone.
const BEACON_STALE_MS = 90_000;

export type RunState = "live" | "ended" | "stopped";

export function runState(run: Run, now: number): RunState {
  if (run.outcome) return "ended";
  return run.beaconAt && now - Date.parse(run.beaconAt) < BEACON_STALE_MS ? "live" : "stopped";
}

export interface StageCell {
  id: string;
  reviews: string | null;
  persist: boolean;
  model: string;
  verdict: Run["verdicts"][number] | null;
  current: boolean;
  agent: LiveAgent | null;
}

export function runStages(run: Run, flows: Pick<Flow, "name" | "stages">[], agents: LiveAgent[], now: number): StageCell[] {
  const stages = run.stages ?? flows.find((flow) => flow.name === run.name)?.stages ?? [];
  const live = runState(run, now) === "live";
  return stages.map((stage) => {
    const verdicts = run.verdicts.filter((v) => v.stage === stage.id).sort((a, b) => b.round - a.round);
    const agent = agents.find((a) => a.labels["ticket-loop.run"] === run.runId && a.labels["ticket-loop.stage"] === stage.id)
      ?? agents.find((a) => a.id === run.agents[stage.id])
      ?? null;
    return { id: stage.id, reviews: stage.reviews, persist: stage.persist, model: stage.model,
      verdict: verdicts[0] ?? null, current: live && run.stage === stage.id, agent };
  });
}
