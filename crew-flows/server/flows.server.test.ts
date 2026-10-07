import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFlows } from "./flows.server";
import { makeTempDir } from "./temp-dir.test-support";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A clone whose origin/main holds `files`, so the reader sees what main has, not the working tree.
function repoOnMain(root: string, name: string, files: Record<string, string>, originUrl?: string) {
  const origin = join(makeTempDir("crew-flows-origin-"), `${name}.git`);
  const dir = join(root, name);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, dir], { stdio: "pipe" });
  for (const [path, text] of Object.entries(files)) write(join(dir, path), text);
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "main");
  git(dir, "push", "-q", "origin", "HEAD:main");
  git(dir, "fetch", "-q", "origin");
  if (originUrl) git(dir, "remote", "set-url", "origin", originUrl);
  return dir;
}

const PLAN_REVIEW = `## The task

**Outcome:** a verdict on whether this plan, built exactly as written, satisfies the issue.

- **Every acceptance criterion is met, and provably.** A criterion the plan cannot demonstrate fails.
- **It is the smallest change that does that.** Speculative abstraction fails.
`;

function traqx(root: string) {
  const briefs = ["plan", "develop", "code-review", "qa", "deploy"];
  return repoOnMain(root, "traqx-bookings", {
    ".claude/ticket-loop.json": fixture("traqx.ticket-loop.json"),
    ".claude/briefs/plan-review.md": PLAN_REVIEW,
    ...Object.fromEntries(briefs.map((b) => [`.claude/briefs/${b}.md`, `**Outcome:** ${b} done.\n`])),
  }, "https://github.com/maxwell-01/traqx-bookings.git");
}

function skillDir() {
  const dir = makeTempDir("crew-flows-skill-");
  write(join(dir, "briefs/craft.md"), "one two three four");
  write(join(dir, "briefs/retro.md"), "# Retro\n\n**Outcome:** a record of what this run reveals about the PROCESS.\n");
  return dir;
}

describe("readFlows", () => {
  it("reads each repo's manifest from origin/main, not its working tree", async () => {
    const root = makeTempDir("crew-flows-root-");
    const dir = traqx(root);
    write(join(dir, ".claude/ticket-loop.json"), JSON.stringify({ name: "stale", stages: [] }));
    const { flows } = await readFlows({ roots: [root], skillDir: skillDir() });
    expect(flows.map((f) => f.name)).toEqual(["traqx"]);
    expect(flows[0]).toMatchObject({ repoDir: dir, remote: "maxwell-01/traqx-bookings", maxRounds: 3, stallSeconds: 1800 });
    expect(flows[0].queue).toMatchObject({ repo: "maxwell-01/traqx-bookings", excludeLabels: ["blocked", "loop:active"], maxTickets: 3 });
  });

  it("gives every stage the manifest's model and thinking unless it names its own", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const [flow] = (await readFlows({ roots: [root], skillDir: skillDir() })).flows;
    const stage = (id: string) => flow.stages.find((s) => s.id === id);
    expect(stage("plan")).toMatchObject({ model: "claude-opus-5", thinking: "high", persist: true, reviews: null });
    expect(stage("develop")).toMatchObject({ model: "claude-sonnet-5", thinking: "medium" });
    expect(stage("qa")).toMatchObject({ persist: false, reviews: "develop", always: false });
  });

  it("summarises a brief by its outcome line, its checks and its length", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const [flow] = (await readFlows({ roots: [root], skillDir: skillDir() })).flows;
    expect(flow.stages.find((s) => s.id === "plan-review")?.brief).toEqual({
      ref: "briefs/plan-review.md",
      words: PLAN_REVIEW.split(/\s+/).filter(Boolean).length,
      outcome: "a verdict on whether this plan, built exactly as written, satisfies the issue.",
      checks: ["Every acceptance criterion is met, and provably.", "It is the smallest change that does that."],
    });
  });

  it("reads a skill: brief from the ticket-loop skill and counts the shared craft brief", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const result = await readFlows({ roots: [root], skillDir: skillDir() });
    expect(result.flows[0].stages.find((s) => s.id === "retro")?.brief?.outcome).toBe(
      "a record of what this run reveals about the PROCESS.",
    );
    expect(result.craftWords).toBe(4);
    expect(result.problems).toEqual([]);
  });

  it("uses a brief's first line when it has no outcome, and surfaces keys loop.py ignores", async () => {
    const root = makeTempDir("crew-flows-root-");
    repoOnMain(root, "gsmail", {
      ".claude/ticket-loop.json": fixture("gsmail.ticket-loop.json"),
      ".claude/briefs/plan.md": "# Plan\n\nPlan the ticket in at most `8` lines.\n",
      ".claude/briefs/plan-review.md": "Read the plan.",
      ".claude/briefs/develop.md": "Implement it.",
      ".claude/briefs/code-review.md": "Check it.",
    });
    const [flow] = (await readFlows({ roots: [root], skillDir: skillDir() })).flows;
    expect(flow.remote).toBeNull();
    expect(flow.stages[0]).toMatchObject({ ownerApproves: true, model: "claude-sonnet-5", thinking: "low" });
    expect(flow.stages[0].brief?.outcome).toBe("Plan the ticket in at most 8 lines.");
    expect(flow.stages[2].asks).toBe("plan");
  });

  it("skips folders with no loop and reports a broken manifest, an unreadable repo or a missing brief", async () => {
    const root = makeTempDir("crew-flows-root-");
    mkdirSync(join(root, "not-a-repo"));
    write(join(root, "dangling/.git"), "gitdir: /nonexistent/worktree\n");
    repoOnMain(root, "no-loop", { "README.md": "hi" });
    repoOnMain(root, "broken", { ".claude/ticket-loop.json": "{ not json" });
    repoOnMain(root, "half", { ".claude/ticket-loop.json": JSON.stringify({ name: "half", stages: [{ id: "plan", brief: "briefs/plan.md" }] }) });
    const result = await readFlows({ roots: [root], skillDir: skillDir() });
    expect(result.flows.map((f) => f.name)).toEqual(["half"]);
    expect(result.flows[0].stages[0].brief).toBeNull();
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toContain("broken");
    expect(result.problems[1]).toContain("dangling");
    expect(result.problems[2]).toContain("half plan: brief briefs/plan.md is not on origin/main");
  });
});
