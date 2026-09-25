import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import { registerRepoNotes } from "./repo-notes.server";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-notes-"));
  dirs.push(dir);
  return dir;
}

function startPlugin(notesDir: Promise<string>) {
  const hooks = new Map<string, (input: { request: unknown }) => unknown>();
  const server = {
    before: (name: string, hook: (input: { request: unknown }) => unknown) => {
      hooks.set(name, hook);
      return () => hooks.delete(name);
    },
  } as unknown as PluginServerContext;
  registerRepoNotes(server, { notesDir });
  return { createAgent: async (config: object) => hooks.get("agent.create")!({ request: { config } }) };
}

function cloneOfMyStuff(): string {
  const repo = tempDir();
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/maxwell-01/myStuff.git"]);
  return repo;
}

describe("registerRepoNotes", () => {
  it("gives a new agent the notes kept for its repo", async () => {
    const notesDir = tempDir();
    const notesFolder = join(notesDir, "repos", "github.com", "maxwell-01", "mystuff");
    mkdirSync(notesFolder, { recursive: true });
    writeFileSync(join(notesFolder, "AGENTS.md"), "Always rebase, never merge.");

    const created = await startPlugin(Promise.resolve(notesDir)).createAgent({ provider: "claude", cwd: cloneOfMyStuff() });

    expect(created).toMatchObject({ config: { systemPrompt: expect.stringContaining("Always rebase, never merge.") } });
    expect(created).toMatchObject({ config: { systemPrompt: expect.stringContaining(join(notesFolder, "AGENTS.md")) } });
  });

  it("leaves an agent in a folder that is not a repo unchanged", async () => {
    const request = { config: { provider: "claude", cwd: tempDir() } };
    expect(await startPlugin(Promise.resolve(tempDir())).createAgent(request.config)).toEqual(request);
  });

  it("still lets the agent start, without notes, when the plugin cannot find its notes folder", async () => {
    const request = { config: { provider: "claude", cwd: cloneOfMyStuff() } };
    const plugin = startPlugin(Promise.reject(new Error("Paseo home not found")));
    expect(await plugin.createAgent(request.config)).toEqual(request);
  });
});
