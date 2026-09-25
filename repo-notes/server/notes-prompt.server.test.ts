import { describe, expect, it } from "vitest";
import { withoutRepoNotes, withRepoNotes } from "./notes-prompt.server";

const repo = { key: "github.com/maxwell-01/mystuff", path: "/home/p/.paseo/plugin-data/repo-notes/repos/github.com/maxwell-01/mystuff/AGENTS.md" };

describe("withRepoNotes", () => {
  it("gives the agent the notes and the file that holds them", () => {
    const config = withRepoNotes({ provider: "claude", cwd: "/repo" }, { ...repo, notes: "Run the smoke test before a push." });
    expect(config.systemPrompt).toContain("Run the smoke test before a push.");
    expect(config.systemPrompt).toContain(repo.path);
    expect(config.systemPrompt).toContain(repo.key);
  });

  it("gives only the file's path when the repo has no notes yet, so the agent knows where to write them", () => {
    const config = withRepoNotes({ provider: "claude", cwd: "/repo" }, { ...repo, notes: "  \n" });
    expect(config.systemPrompt).toContain(repo.path);
    expect(config.systemPrompt).toContain("no notes yet");
  });

  it("adds the notes after a system prompt the agent already had", () => {
    const config = withRepoNotes({ provider: "claude", cwd: "/repo", systemPrompt: "You review code." }, { ...repo, notes: "Be blunt." });
    expect(config.systemPrompt?.startsWith("You review code.\n\n")).toBe(true);
    expect(config.systemPrompt).toContain("Be blunt.");
  });

  it("replaces the notes an agent inherited, since Paseo copies a parent's prompt into its child agents and schedules", () => {
    const parent = withRepoNotes({ provider: "claude", cwd: "/a", systemPrompt: "You review code." }, { ...repo, notes: "Old rule." });
    const child = withRepoNotes({ ...parent, cwd: "/b" }, { ...repo, key: "github.com/x/other", notes: "New rule." });
    expect(child.systemPrompt).not.toContain("Old rule.");
    expect(child.systemPrompt?.match(/New rule\./g)).toHaveLength(1);
    expect(child.systemPrompt?.startsWith("You review code.\n\n")).toBe(true);
  });
});

describe("withoutRepoNotes", () => {
  it("removes inherited notes from an agent that has no repo", () => {
    const parent = withRepoNotes({ provider: "claude", cwd: "/a", systemPrompt: "You review code." }, { ...repo, notes: "Old rule." });
    expect(withoutRepoNotes(parent).systemPrompt).toBe("You review code.");
  });

  it("leaves a config with no notes as it was", () => {
    const config = { provider: "claude", cwd: "/a" };
    expect(withoutRepoNotes(config)).toBe(config);
  });
});
