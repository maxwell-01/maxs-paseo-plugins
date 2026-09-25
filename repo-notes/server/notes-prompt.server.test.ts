import { describe, expect, it } from "vitest";
import { withRepoNotes } from "./notes-prompt.server";

const repo = { key: "github.com/maxwell-01/myStuff", path: "/home/p/.paseo/plugin-data/repo-notes/repos/github.com/maxwell-01/myStuff/AGENTS.md" };

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
});
