import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Brief, Flow, FlowList, Stage } from "../shared/flows.shared";
import { git } from "./git.server";

const MANIFEST = ".claude/ticket-loop.json";
const MAIN = "origin/main";
const SKILL_PREFIX = "skill:";

// The defaults loop.py's load() applies, so a stage shows what the engine will actually run.
export const manifestSchema = z.object({
  name: z.string().default("ticket-loop"),
  model: z.string().default("claude-sonnet-5"),
  thinking: z.string().default("medium"),
  max_rounds: z.number().default(3),
  stall_seconds: z.number().default(420),
  stages: z.array(z.object({
    id: z.string(),
    brief: z.string(),
    reviews: z.string().optional(),
    persist: z.boolean().default(true),
    always: z.boolean().default(false),
    model: z.string().optional(),
    thinking: z.string().optional(),
    owner_approves: z.boolean().default(false),
    asks: z.string().optional(),
  })).min(1),
  queue: z.object({
    repo: z.string(),
    labels: z.array(z.string()).default([]),
    exclude_labels: z.array(z.string()).default([]),
    order: z.string().optional(),
    max_tickets: z.number().optional(),
  }).optional(),
});

export interface FlowSources {
  roots: string[];
  skillDir: string;
}

export function summariseBrief(ref: string, text: string): Brief {
  const plain = (line: string) => line.replace(/[`*]/g, "").trim();
  const outcome = /\*\*Outcome[^*]*:\*\*\s*(.+)/.exec(text)?.[1]
    ?? text.split("\n").find((line) => line.trim() && !line.startsWith("#"))
    ?? "";
  const checks = [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1]);
  return { ref, words: text.split(/\s+/).filter(Boolean).length, outcome: plain(outcome), checks };
}

function githubRepo(url: string): string | null {
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url.trim())?.[1] ?? null;
}

async function gitRepos(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, ".git")));
}

async function readFlow(dir: string, skillDir: string, problems: string[]): Promise<Flow | null> {
  if (!(await git(dir, ["for-each-ref", `refs/remotes/${MAIN}`])).trim()) return null;
  const onMain = new Set((await git(dir, ["ls-tree", "-r", "--name-only", MAIN, "--", ".claude"])).split("\n"));
  if (!onMain.has(MANIFEST)) return null;
  const manifest = manifestSchema.parse(JSON.parse(await git(dir, ["show", `${MAIN}:${MANIFEST}`])));

  async function brief(ref: string, stageId: string): Promise<Brief | null> {
    if (ref.startsWith(SKILL_PREFIX)) {
      const path = join(skillDir, ref.slice(SKILL_PREFIX.length));
      if (existsSync(path)) return summariseBrief(ref, await readFile(path, "utf8"));
      problems.push(`${manifest.name} ${stageId}: brief ${path} not found`);
      return null;
    }
    const path = `.claude/${ref}`;
    if (onMain.has(path)) return summariseBrief(ref, await git(dir, ["show", `${MAIN}:${path}`]));
    problems.push(`${manifest.name} ${stageId}: brief ${ref} is not on ${MAIN}`);
    return null;
  }

  const stages: Stage[] = [];
  for (const s of manifest.stages) {
    stages.push({
      id: s.id,
      model: s.model ?? manifest.model,
      thinking: s.thinking ?? manifest.thinking,
      persist: s.persist,
      always: s.always,
      reviews: s.reviews ?? null,
      ownerApproves: s.owner_approves,
      asks: s.asks ?? null,
      brief: await brief(s.brief, s.id),
    });
  }
  const queue = manifest.queue;
  return {
    name: manifest.name,
    repoDir: dir,
    remote: githubRepo(await git(dir, ["ls-remote", "--get-url", "origin"])),
    manifestPath: MANIFEST,
    maxRounds: manifest.max_rounds,
    stallSeconds: manifest.stall_seconds,
    queue: queue
      ? { repo: queue.repo, labels: queue.labels, excludeLabels: queue.exclude_labels, order: queue.order ?? null, maxTickets: queue.max_tickets ?? null }
      : null,
    stages,
  };
}

export async function readFlows({ roots, skillDir }: FlowSources): Promise<FlowList> {
  const problems: string[] = [];
  const flows: Flow[] = [];
  for (const root of roots) {
    for (const dir of await gitRepos(root)) {
      try {
        const flow = await readFlow(dir, skillDir, problems);
        if (flow) flows.push(flow);
      } catch (error) {
        problems.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const craft = join(skillDir, "briefs", "craft.md");
  const craftWords = existsSync(craft) ? summariseBrief("craft.md", await readFile(craft, "utf8")).words : null;
  if (craftWords === null) problems.push(`shared brief ${craft} not found`);
  return { flows, craftWords, problems };
}
