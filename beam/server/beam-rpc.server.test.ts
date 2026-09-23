import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activateWithTitleMark, deactivateWithTitleMark } from "./beam-rpc.server";
import { getBeamLog } from "./beam.server";
import { createFakeWorkspacePort } from "./workspace-port.fake";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function lastWarning(): string | undefined {
  return getBeamLog().filter((entry) => entry.level === "warn").at(-1)?.message;
}

describe("beam RPC handlers", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;
  let realHome: string | undefined;
  let beamInput: { workspaceId: string; workspaceName: string; workspaceDir: string };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-rpc-"));
    mainRepo = join(root, "main");
    wsDir = join(root, "ws");
    mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    writeFileSync(join(mainRepo, "tracked.txt"), "original\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");
    git(mainRepo, "worktree", "add", "-b", "feature", wsDir);
    beamInput = { workspaceId: "ws-1", workspaceName: "beam-live", workspaceDir: wsDir };

    realHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(() => {
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("marks the workspace on beam-in and restores it on beam-out", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });

    await activateWithTitleMark(workspace.port, beamInput);
    expect(workspace.currentTitle()).toBe("⚡ beam-live");

    await deactivateWithTitleMark(workspace.port);
    expect(workspace.currentTitle()).toBeNull();
  });

  it("still beams in, and logs why, when the workspace title cannot be read", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null }, { refresh: true });

    await expect(activateWithTitleMark(workspace.port, beamInput)).resolves.toEqual({
      active: true,
      mainPath: mainRepo,
    });
    expect(lastWarning()).toBe("could not read the workspace title: daemon unreachable");
    expect(workspace.currentTitle()).toBeNull();

    await deactivateWithTitleMark(workspace.port);
  });

  it("still reports beam-in success, and logs why, when the mark cannot be written", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null }, { setTitle: true });

    await expect(activateWithTitleMark(workspace.port, beamInput)).resolves.toEqual({
      active: true,
      mainPath: mainRepo,
    });
    expect(lastWarning()).toBe("could not mark the workspace as beaming: daemon unreachable");

    await deactivateWithTitleMark(workspace.port);
  });

  it("still reports beam-out success, and logs why, when the title cannot be restored", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: "Checkout rewrite" });
    await activateWithTitleMark(workspace.port, beamInput);
    workspace.failures.setTitle = true;

    await expect(deactivateWithTitleMark(workspace.port)).resolves.toEqual({ active: false });
    expect(lastWarning()).toBe(
      "could not restore the workspace title to Checkout rewrite: daemon unreachable",
    );
  });
});
