import { describe, expect, it } from "vitest";
import type { LiveAgent, Run } from "../shared/teams.shared";
import { triage } from "./triage.client";

const NOW = Date.parse("2026-10-06T17:30:00Z");
const CREW = { "firstmate.role": "crew", "paseo.parent-agent-id": "fm" };

function agent(id: string, labels: Record<string, string>, lastSaid: string | null = null, status = "idle"): LiveAgent {
  return { id, title: id, status, model: null, needsYou: false, labels, updatedAt: "", lastSaid };
}

function run(runId: string, extra: Partial<Run> = {}): Run {
  return { stateDir: `/s/${runId}-state`, name: "traqx", runId, issue: "294", stage: "develop", round: 1,
    beaconAt: "2026-10-06T17:29:30Z", outcome: null, manifestPath: null, stages: null, agents: {}, verdicts: [], logTail: null, ...extra };
}

const ids = (members: { agent: LiveAgent }[]) => members.map((member) => member.agent.id);

describe("triage", () => {
  const mate = agent("fm", { "firstmate.role": "first-mate" });

  it("puts agents asking for a permission and crewmates stopped for a decision under needs you, with their question", () => {
    const asking = { ...agent("asking", { "crew-flows.run": "r", "crew-flows.stage": "develop" }, "May I run the migration?"), needsYou: true };
    const { needsYou } = triage([mate, asking,
      agent("deciding", CREW, "Two options.\n\nneeds-decision: keep the toolbar or remove it?"),
      agent("blocked", CREW, "blocked: no Zone:Edit on the token"),
      agent("busy", CREW, "working: on it")], [], NOW);
    expect(needsYou.map((m) => [m.agent.id, m.state, m.line])).toEqual([
      ["asking", null, "May I run the migration?"],
      ["deciding", "needs-decision", "keep the toolbar or remove it?"],
      ["blocked", "blocked", "no Zone:Edit on the token"],
    ]);
  });

  it("lists a crewmate that is both flagged by Paseo and stopped for a decision once", () => {
    const both = { ...agent("both", CREW, "needs-decision: which port?"), needsYou: true };
    expect(ids(triage([mate, both], [], NOW).needsYou)).toEqual(["both"]);
  });

  it("counts a crewmate whose agent runs again as running, since its last state line is from the turn before", () => {
    const { needsYou, running } = triage([mate, agent("answered", CREW, "needs-decision: pick one", "running")], [], NOW);
    expect(ids(needsYou)).toEqual([]);
    expect(ids(running)).toEqual(["answered"]);
  });

  it("folds every other crewmate into done or idle", () => {
    const { running, doneOrIdle } = triage([mate,
      agent("shipped", CREW, "done: PR #12 open"),
      agent("quiet", CREW, null),
      agent("live", CREW, "working: tests", "running")], [], NOW);
    expect(ids(running)).toEqual(["live"]);
    expect(ids(doneOrIdle)).toEqual(["shipped", "quiet"]);
  });

  it("splits runs into live ones and recent ones that ended or stopped", () => {
    const { liveRuns, recentRuns } = triage([], [
      run("live"),
      run("ended", { outcome: "PASS" }),
      run("stopped", { beaconAt: "2026-10-06T17:00:00Z" }),
    ], NOW);
    expect(liveRuns.map((r) => r.runId)).toEqual(["live"]);
    expect(recentRuns.map((r) => r.runId)).toEqual(["ended", "stopped"]);
  });
});
