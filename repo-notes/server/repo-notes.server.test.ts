import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRepoNotes } from "./repo-notes.server";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-notes-"));
  dirs.push(dir);
  return dir;
}

function startPlugin(notesDir: Promise<string>) {
  const hooks = new Map<string, (input: { request: unknown }) => unknown>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const server = {
    handle: (contract: { name: string }, handler: (input: unknown) => unknown) => handlers.set(contract.name, handler),
    before: (name: string, hook: (input: { request: unknown }) => unknown) => {
      hooks.set(name, hook);
      return () => hooks.delete(name);
    },
  } as unknown as PluginServerContext;
  registerRepoNotes(server, { notesDir });
  return {
    createAgent: async (config: object) => hooks.get("agent.create")!({ request: { config } }),
    call: async (name: string, input: unknown) => handlers.get(name)!(input),
  };
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
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = { config: { provider: "claude", cwd: cloneOfMyStuff() } };
    const plugin = startPlugin(Promise.reject(new Error("Paseo home not found")));
    expect(await plugin.createAgent(request.config)).toEqual(request);
    expect(logError).toHaveBeenCalledWith("repo-notes: gave a new agent no notes", expect.any(Error));
  });

  it("still lets the agent start, without notes, when git fails in its folder", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = { config: { provider: "claude", cwd: join(tempDir(), "missing") } };
    expect(await startPlugin(Promise.resolve(tempDir())).createAgent(request.config)).toEqual(request);
    expect(logError).toHaveBeenCalledWith("repo-notes: gave a new agent no notes", expect.any(Error));
  });

  it("gives no notes, and logs it, when the notes file is too large for a prompt", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const notesDir = tempDir();
    const notesFolder = join(notesDir, "repos", "github.com", "maxwell-01", "mystuff");
    mkdirSync(notesFolder, { recursive: true });
    writeFileSync(join(notesFolder, "AGENTS.md"), "x".repeat(100_001));
    const request = { config: { provider: "claude", cwd: cloneOfMyStuff() } };
    expect(await startPlugin(Promise.resolve(notesDir)).createAgent(request.config)).toEqual(request);
    expect(logError).toHaveBeenCalledWith("repo-notes: gave a new agent no notes", expect.any(Error));
  });
});

describe("sync RPCs", () => {
  it("gives a note written through one daemon's RPC to a new agent there", async () => {
    const plugin = startPlugin(Promise.resolve(tempDir()));
    await plugin.call("repo-notes.write", { key: "github.com/maxwell-01/mystuff", content: "Squash on merge.", modifiedAt: 1_750_000_000_000, expectedHash: null });

    expect(await plugin.call("repo-notes.list", {})).toMatchObject({ notes: [{ key: "github.com/maxwell-01/mystuff", modifiedAt: 1_750_000_000_000 }] });
    expect(await plugin.call("repo-notes.read", { key: "github.com/maxwell-01/mystuff" })).toMatchObject({
      notes: { content: "Squash on merge.", modifiedAt: 1_750_000_000_000 },
    });
    expect(await plugin.call("repo-notes.read", { key: "github.com/x/none" })).toEqual({ notes: null });
    const created = await plugin.createAgent({ provider: "claude", cwd: cloneOfMyStuff() });
    expect(created).toMatchObject({ config: { systemPrompt: expect.stringContaining("Squash on merge.") } });
  });
});
