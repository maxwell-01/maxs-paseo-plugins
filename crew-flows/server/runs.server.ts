import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Run } from "../shared/teams.shared";
import { manifestSchema } from "./flows.server";

const STATE_SUFFIX = "-state";
const LOG_TAIL_LINES = 20;
const VERDICT_FILE = /^(.+)-(\d+)\.json$/;

// loop.py's Beacon. `manifest` and `agents` arrived later, so older beacons lack them.
const beaconSchema = z.object({
  run_id: z.string(),
  issue: z.string().nullable(),
  stage: z.string().nullable(),
  round: z.number().nullable(),
  ts: z.string().optional(),
  outcome: z.string().optional(),
  manifest: z.string().optional(),
  agents: z.record(z.string(), z.string()).default({}),
});

const verdictSchema = z.object({ verdict: z.string(), findings: z.array(z.unknown()).nullish() });

async function readText(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, "utf8") : null;
}

async function manifestStages(path: string) {
  const text = await readText(path);
  if (text === null) return null;
  const manifest = manifestSchema.parse(JSON.parse(text));
  return {
    name: manifest.name,
    stages: manifest.stages.map((s) => ({ id: s.id, reviews: s.reviews ?? null, persist: s.persist, always: s.always, model: s.model ?? manifest.model })),
  };
}

async function readRun(dir: string): Promise<Run | null> {
  const alive = await readText(join(dir, "alive"));
  if (alive === null) return null;
  const beacon = beaconSchema.parse(JSON.parse(alive));
  const manifest = beacon.manifest ? await manifestStages(beacon.manifest) : null;
  const files = (await readdir(dir)).sort();
  const verdicts = [];
  for (const file of files) {
    const match = VERDICT_FILE.exec(file);
    if (!match) continue;
    const verdict = verdictSchema.parse(JSON.parse(await readFile(join(dir, file), "utf8")));
    verdicts.push({ stage: match[1], round: Number(match[2]), verdict: verdict.verdict, findings: verdict.findings?.length ?? 0 });
  }
  const log = await readText(join(dir, "loop.log"));
  const outcome = beacon.outcome ?? (await readText(join(dir, "outcome")))?.trim() ?? null;
  return {
    stateDir: dir,
    name: manifest?.name ?? beacon.run_id.replace(/-\d{8}T\d{6}Z$/, "").replace(beacon.issue ? `-${beacon.issue}` : "", ""),
    runId: beacon.run_id,
    issue: beacon.issue,
    stage: beacon.stage,
    round: beacon.round,
    beaconAt: beacon.ts ?? null,
    outcome,
    manifestPath: beacon.manifest ?? null,
    stages: manifest?.stages ?? null,
    agents: beacon.agents,
    verdicts,
    logTail: log === null ? [] : log.trimEnd().split("\n").slice(-LOG_TAIL_LINES),
  };
}

export async function readRuns(stateRoot: string): Promise<{ runs: Run[]; problems: string[] }> {
  if (!existsSync(stateRoot)) return { runs: [], problems: [] };
  const dirs = (await readdir(stateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(STATE_SUFFIX));
  const runs: Run[] = [];
  const problems: string[] = [];
  for (const entry of dirs) {
    const dir = join(stateRoot, entry.name);
    try {
      const run = await readRun(dir);
      if (run) runs.push(run);
    } catch (error) {
      problems.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  runs.sort((a, b) => (b.beaconAt ?? "").localeCompare(a.beaconAt ?? ""));
  return { runs, problems };
}
