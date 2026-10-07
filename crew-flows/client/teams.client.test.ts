import { describe, expect, it } from "vitest";
import type { Flow } from "../shared/flows.shared";
import type { LiveAgent, Run } from "../shared/teams.shared";
import { runStages, runState } from "./teams.client";

const NOW = Date.parse("2026-10-06T17:30:00Z");

function run(extra: Partial<Run> = {}): Run {
  return { stateDir: "/s/traqx-294-state", name: "traqx", runId: "traqx-294-x", issue: "294", stage: "develop", round: 2,
    beaconAt: "2026-10-06T17:29:30Z", outcome: null, manifestPath: null, stages: null, agents: {}, verdicts: [], logTail: null, ...extra };
}

function agent(id: string, labels: Record<string, string>): LiveAgent {
  return { id, title: null, status: "running", model: null, needsYou: false, labels, updatedAt: "", lastSaid: null };
}

const stage = (id: string, reviews: string | null = null) =>
  ({ id, reviews, persist: true, always: false, model: "claude-sonnet-5" });

describe("runState", () => {
  it("is live while the beacon is fresh and there is no outcome", () => {
    expect(runState(run(), NOW)).toBe("live");
  });

  it("is ended once an outcome is written, and stopped when the beacon went quiet without one", () => {
    expect(runState(run({ outcome: "PASS" }), NOW)).toBe("ended");
    expect(runState(run({ beaconAt: "2026-10-06T17:25:42Z" }), NOW)).toBe("stopped");
  });
});

describe("runStages", () => {
  const flows = [{ name: "traqx", stages: [stage("plan"), stage("develop"), stage("code-review", "develop")] }] as Pick<Flow, "name" | "stages">[];

  it("falls back to the repo's flow, and gives each stage its latest verdict and live agent", () => {
    const cells = runStages(run({ verdicts: [
      { stage: "code-review", round: 1, verdict: "FAIL", findings: 2 },
      { stage: "develop", round: 1, verdict: "PASS", findings: 0 },
      { stage: "plan", round: 1, verdict: "PASS", findings: 0 },
    ], agents: { plan: "p1" } }), flows, [
      agent("d2", { "ticket-loop.run": "traqx-294-x", "ticket-loop.stage": "develop" }),
      agent("d9", { "ticket-loop.run": "other-run", "ticket-loop.stage": "develop" }),
      // A run from before the ticket-loop labels: only the subscription guard's crew label, found by the beacon's map.
      agent("p1", { "firstmate.role": "crew" }),
    ], NOW);
    expect(cells.map((c) => [c.id, c.verdict?.verdict ?? null, c.current, c.agent?.id ?? null])).toEqual([
      ["plan", "PASS", false, "p1"],
      ["develop", "PASS", true, "d2"],
      ["code-review", "FAIL", false, null],
    ]);
  });

  it("uses the stages the run recorded over the repo's flow", () => {
    expect(runStages(run({ stages: [stage("plan")] }), flows, [], NOW).map((c) => c.id)).toEqual(["plan"]);
  });
});
