import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRuns } from "./runs.server";
import { makeTempDir } from "./temp-dir.test-support";

function stateDir(root: string, name: string, files: Record<string, string>) {
  const dir = join(root, `${name}-state`);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}

describe("readRuns", () => {
  it("reads a run's beacon, the agent of each stage, its manifest's stages and its verdicts", async () => {
    const root = makeTempDir("crew-flows-runs-");
    const manifest = join(root, "ticket-loop.json");
    writeFileSync(manifest, JSON.stringify({ name: "traqx", stages: [
      { id: "plan", brief: "b.md" }, { id: "plan-review", brief: "b.md", reviews: "plan", persist: false }] }));
    stateDir(root, "traqx-294", {
      alive: JSON.stringify({ run_id: "traqx-294-20261006T172341Z", issue: "294", stage: "plan-review", round: 2,
        ts: "2026-10-06T17:25:42Z", manifest, agents: { plan: "a1", "plan-review": "a2" } }),
      "plan-1.json": JSON.stringify({ verdict: "PASS", findings: [] }),
      "plan-review-1.json": JSON.stringify({ verdict: "FAIL", findings: ["one", { file: "a.ts" }] }),
      "loop.log": "line 1\nline 2\n",
    });
    const [run] = (await readRuns(root)).runs;
    expect(run).toMatchObject({
      name: "traqx", runId: "traqx-294-20261006T172341Z", issue: "294", stage: "plan-review", round: 2,
      beaconAt: "2026-10-06T17:25:42Z", outcome: null, agents: { plan: "a1", "plan-review": "a2" },
      logTail: ["line 1", "line 2"],
    });
    expect(run.stages).toEqual([
      { id: "plan", reviews: null, persist: true, always: false, model: "claude-sonnet-5" },
      { id: "plan-review", reviews: "plan", persist: false, always: false, model: "claude-sonnet-5" },
    ]);
    expect(run.verdicts).toEqual([
      { stage: "plan", round: 1, verdict: "PASS", findings: 0 },
      { stage: "plan-review", round: 1, verdict: "FAIL", findings: 2 },
    ]);
  });

  it("names a run from before the beacon recorded its manifest by its run id, and reads its outcome file", async () => {
    const root = makeTempDir("crew-flows-runs-");
    stateDir(root, "ha-896", {
      alive: JSON.stringify({ run_id: "homeassistant-896-20261006T171344Z", issue: "896", stage: "qa", round: 1, ts: "2026-10-06T17:13:44Z" }),
      outcome: "SUBSCRIPTION_PAUSED\n",
    });
    const [run] = (await readRuns(root)).runs;
    expect(run).toMatchObject({ name: "homeassistant", stages: null, agents: {}, outcome: "SUBSCRIPTION_PAUSED", manifestPath: null, logTail: null });
  });

  it("skips a state dir with no beacon, reports a broken one, and finds none when the root is missing", async () => {
    const root = makeTempDir("crew-flows-runs-");
    stateDir(root, "empty", {});
    mkdirSync(join(root, "traqx-31"));
    stateDir(root, "broken", { alive: "{", "plan-1.json": "{}" });
    const { runs, problems } = await readRuns(root);
    expect(runs).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("broken-state");
    expect(await readRuns(join(root, "absent"))).toEqual({ runs: [], problems: [] });
  });
});
