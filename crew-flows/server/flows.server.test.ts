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
    ".claude/crew-flows.json": fixture("traqx.crew-flows.json"),
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

// The current crewFlows format: a stage with no brief runs the shared role of its `role`, or of its id.
const ROLE_MANIFEST = {
  name: "editor", model: "claude-sonnet-5-5", thinking: "low", queue: { repo: "o/editor" },
  stages: [
    { id: "plan" },
    { id: "size-plan", role: "right-size", reviews: "plan" },
    { id: "develop", model: "codex/gpt-6-astra", thinking: "high" },
    { id: "notes", brief: "skill:briefs/notes.md" },
    { id: "qa" },
  ],
};

function roleSkillDir() {
  const dir = skillDir();
  write(join(dir, "roles/defaults.json"), JSON.stringify({
    plan: { model: "claude-opus-5-5", thinking: "medium" },
    "right-size": { model: "claude-sonnet-5-5", thinking: "medium", persist: false },
    develop: { model: "claude-sonnet-5-5", thinking: "medium" },
  }));
  write(join(dir, "roles/plan.md"), "**Outcome:** a plan.\n");
  write(join(dir, "roles/right-size.md"), "**Outcome:** the smallest change.\n");
  write(join(dir, "roles/develop.md"), "**Outcome:** the change.\n");
  write(join(dir, "briefs/notes.md"), "**Outcome:** notes.\n");
  write(join(dir, "roles/qa.md"), "**Outcome:** proof.\n");
  return dir;
}

describe("readFlows", () => {
  it("reads each repo's manifest from origin/main, not its working tree", async () => {
    const root = makeTempDir("crew-flows-root-");
    const dir = traqx(root);
    write(join(dir, ".claude/crew-flows.json"), JSON.stringify({ name: "stale", stages: [] }));
    const { flows } = await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() });
    expect(flows.map((f) => f.name)).toEqual(["traqx"]);
    expect(flows[0]).toMatchObject({ repoDir: dir, remote: "maxwell-01/traqx-bookings", maxRounds: 3, stallSeconds: 1800 });
    expect(flows[0].queue).toMatchObject({ repo: "maxwell-01/traqx-bookings", excludeLabels: ["blocked", "loop:active"], maxTickets: 3 });
  });

  it("gives every stage the manifest's model and thinking unless it names its own", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const [flow] = (await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() })).flows;
    const stage = (id: string) => flow.stages.find((s) => s.id === id);
    expect(stage("plan")).toMatchObject({ model: "claude-opus-5", thinking: "high", persist: true, reviews: null });
    expect(stage("develop")).toMatchObject({ model: "claude-sonnet-5", thinking: "medium" });
    expect(stage("qa")).toMatchObject({ persist: false, reviews: "develop", always: false });
  });

  it("summarises a brief by its outcome line, its checks and its length", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const [flow] = (await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() })).flows;
    expect(flow.stages.find((s) => s.id === "plan-review")?.brief).toEqual({
      ref: "briefs/plan-review.md",
      words: PLAN_REVIEW.split(/\s+/).filter(Boolean).length,
      outcome: "a verdict on whether this plan, built exactly as written, satisfies the issue.",
      checks: ["Every acceptance criterion is met, and provably.", "It is the smallest change that does that."],
    });
  });

  it("reads a skill: brief from the crewFlows skill and counts the shared craft brief", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() });
    expect(result.flows[0].stages.find((s) => s.id === "retro")?.brief?.outcome).toBe(
      "a record of what this run reveals about the PROCESS.",
    );
    expect(result.craftWords).toBe(4);
    expect(result.problems).toEqual([]);
  });

  it("uses a brief's first line when it has no outcome, and surfaces keys loop.py ignores", async () => {
    const root = makeTempDir("crew-flows-root-");
    repoOnMain(root, "gsmail", {
      ".claude/crew-flows.json": fixture("gsmail.crew-flows.json"),
      ".claude/briefs/plan.md": "# Plan\n\nPlan the ticket in at most `8` lines.\n",
      ".claude/briefs/plan-review.md": "Read the plan.",
      ".claude/briefs/develop.md": "Implement it.",
      ".claude/briefs/code-review.md": "Check it.",
    });
    const [flow] = (await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() })).flows;
    expect(flow.remote).toBeNull();
    expect(flow.stages[0]).toMatchObject({ ownerApproves: true, model: "claude-sonnet-5", thinking: "low" });
    expect(flow.stages[0].brief?.outcome).toBe("Plan the ticket in at most 8 lines.");
    expect(flow.stages[2].asks).toBe("plan");
  });

  it("reads a stage with no brief as a shared role, with the role's prompt and defaults from the crewFlows skill", async () => {
    const root = makeTempDir("crew-flows-root-");
    repoOnMain(root, "editor", { ".claude/crew-flows.json": JSON.stringify(ROLE_MANIFEST) });
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: roleSkillDir() });
    expect(result.problems).toEqual([]);
    expect(result.flows[0].stages.map((s) => [s.id, s.model, s.thinking, s.persist, s.reviews, s.brief?.ref, s.brief?.outcome])).toEqual([
      ["plan", "claude-opus-5-5", "medium", true, null, "skill:roles/plan.md", "a plan."],
      ["size-plan", "claude-sonnet-5-5", "medium", false, "plan", "skill:roles/right-size.md", "the smallest change."],
      ["develop", "codex/gpt-6-astra", "high", true, null, "skill:roles/develop.md", "the change."],
      ["notes", "claude-sonnet-5-5", "low", true, null, "skill:briefs/notes.md", "notes."],
      ["qa", "claude-sonnet-5-5", "low", true, null, "skill:roles/qa.md", "proof."],
    ]);
  });

  it("refuses a stage that names both a role and a brief, as loop.py does", async () => {
    const root = makeTempDir("crew-flows-root-");
    repoOnMain(root, "editor", { ".claude/crew-flows.json": JSON.stringify({ name: "editor", stages: [{ id: "plan", role: "plan", brief: "briefs/plan.md" }] }) });
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: roleSkillDir() });
    expect(result.flows).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("names both a role and a brief");
  });

  it("reports a role stage when the crewFlows skill folder has no role defaults", async () => {
    const root = makeTempDir("crew-flows-root-");
    repoOnMain(root, "editor", { ".claude/crew-flows.json": JSON.stringify(ROLE_MANIFEST) });
    const skill = skillDir();
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: skill });
    expect(result.flows).toEqual([]);
    expect(result.problems).toEqual([expect.stringContaining(`${join(skill, "roles/defaults.json")} not found`)]);
  });

  it("reports a role defaults file that does not parse once, and still reads a manifest of briefs", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    repoOnMain(root, "editor", { ".claude/crew-flows.json": JSON.stringify(ROLE_MANIFEST) });
    const skill = roleSkillDir();
    write(join(skill, "roles/defaults.json"), "{ not json");
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: skill });
    expect(result.flows.map((f) => f.name)).toEqual(["traqx"]);
    expect(result.problems).toEqual([
      expect.stringContaining(`${join(skill, "roles/defaults.json")}:`),
      expect.stringContaining("editor plan: role defaults"),
    ]);
  });

  it("reads repos given directly, as the host's Paseo projects are", async () => {
    const root = makeTempDir("crew-flows-root-");
    const dir = traqx(root);
    const result = await readFlows({ roots: [], repoDirs: [dir], skillDir: skillDir() });
    expect(result.flows.map((f) => f.repoDir)).toEqual([dir]);
  });

  it("leaves a missing craft.md to the brief that prepends it, not to the problems", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: makeTempDir("crew-flows-skill-") });
    expect(result.craftWords).toBeNull();
    expect(result.problems.filter((p) => p.includes("craft.md"))).toEqual([]);
  });

  it("reports a repo folder that does not exist on this host and still reads the others", async () => {
    const root = makeTempDir("crew-flows-root-");
    traqx(root);
    const result = await readFlows({ roots: [join(root, "typo"), root], repoDirs: [], skillDir: skillDir() });
    expect(result.flows.map((f) => f.name)).toEqual(["traqx"]);
    expect(result.problems).toEqual([`repo folder ${join(root, "typo")} does not exist`]);
  });

  it("skips folders with no loop and reports a broken manifest, an unreadable repo or a missing brief", async () => {
    const root = makeTempDir("crew-flows-root-");
    mkdirSync(join(root, "not-a-repo"));
    write(join(root, "dangling/.git"), "gitdir: /nonexistent/worktree\n");
    repoOnMain(root, "no-loop", { "README.md": "hi" });
    repoOnMain(root, "broken", { ".claude/crew-flows.json": "{ not json" });
    repoOnMain(root, "half", { ".claude/crew-flows.json": JSON.stringify({ name: "half", stages: [{ id: "plan", brief: "briefs/plan.md" }] }) });
    const result = await readFlows({ roots: [root], repoDirs: [], skillDir: skillDir() });
    expect(result.flows.map((f) => f.name)).toEqual(["half"]);
    expect(result.flows[0].stages[0].brief).toBeNull();
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toContain("broken");
    expect(result.problems[1]).toContain("dangling");
    expect(result.problems[2]).toContain("half plan: brief briefs/plan.md is not on origin/main");
  });
});
