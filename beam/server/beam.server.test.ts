import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activate, deactivate, midOperationReason, restoreMain, snapshotMain, syncOnce } from "./beam.server";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tryGit(cwd: string, ...args: string[]): void {
  try {
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "ignore" });
  } catch {
    // some commands (e.g. a conflicting merge) exit non-zero on purpose
  }
}

describe("syncOnce", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-test-"));
    mainRepo = join(root, "main");
    wsDir = join(root, "ws");
    mkdirSync(mainRepo, { recursive: true });

    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    git(mainRepo, "config", "core.autocrlf", "false");

    writeFileSync(join(mainRepo, "tracked.txt"), "original\n");
    writeFileSync(join(mainRepo, "todelete.txt"), "delete me\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");

    git(mainRepo, "worktree", "add", "-b", "feature", wsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("mirrors a committed modification to a tracked file", () => {
    writeFileSync(join(wsDir, "tracked.txt"), "changed\n");
    git(wsDir, "commit", "-am", "change tracked");

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe("changed\n");
  });

  it("mirrors an uncommitted modification (full working tree, not committed-only)", () => {
    writeFileSync(join(wsDir, "tracked.txt"), "uncommitted\n");

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe("uncommitted\n");
  });

  it("mirrors a new untracked non-ignored file", () => {
    writeFileSync(join(wsDir, "newfile.txt"), "brand new\n");

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(readFileSync(join(mainRepo, "newfile.txt"), "utf8")).toBe("brand new\n");
  });

  it("removes a file deleted in the workspace", () => {
    rmSync(join(wsDir, "todelete.txt"));

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(existsSync(join(mainRepo, "todelete.txt"))).toBe(false);
  });

  it("keeps main's ignored files and does not mirror the workspace's ignored files", () => {
    writeFileSync(join(wsDir, ".gitignore"), "secret.env\nignored-ws.txt\n");
    writeFileSync(join(wsDir, "ignored-ws.txt"), "should not mirror\n");
    writeFileSync(join(mainRepo, "secret.env"), "MAIN SECRET\n");

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(existsSync(join(mainRepo, "secret.env"))).toBe(true);
    expect(readFileSync(join(mainRepo, "secret.env"), "utf8")).toBe("MAIN SECRET\n");
    expect(existsSync(join(mainRepo, "ignored-ws.txt"))).toBe(false);
  });

  it("moves main's branch to the workspace HEAD", () => {
    writeFileSync(join(wsDir, "tracked.txt"), "committed change\n");
    git(wsDir, "commit", "-am", "advance feature");
    const wsHead = git(wsDir, "rev-parse", "HEAD");
    const mainHeadBefore = git(mainRepo, "rev-parse", "HEAD");
    expect(wsHead).not.toBe(mainHeadBefore);

    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(git(mainRepo, "rev-parse", "HEAD")).toBe(wsHead);
  });

  it("skips and leaves main untouched when the workspace is mid-merge", () => {
    writeFileSync(join(wsDir, "conflict.txt"), "base\n");
    git(wsDir, "add", "-A");
    git(wsDir, "commit", "-m", "base conflict");

    git(wsDir, "checkout", "-b", "branchA");
    writeFileSync(join(wsDir, "conflict.txt"), "AAAA\n");
    git(wsDir, "commit", "-am", "A");

    git(wsDir, "checkout", "feature");
    writeFileSync(join(wsDir, "conflict.txt"), "BBBB\n");
    git(wsDir, "commit", "-am", "B");

    tryGit(wsDir, "merge", "branchA");

    expect(midOperationReason(wsDir)).not.toBeNull();

    const mainHeadBefore = git(mainRepo, "rev-parse", "HEAD");
    const trackedBefore = readFileSync(join(mainRepo, "tracked.txt"), "utf8");

    expect(syncOnce(wsDir, mainRepo)).toBe(false);
    expect(git(mainRepo, "rev-parse", "HEAD")).toBe(mainHeadBefore);
    expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe(trackedBefore);
    expect(existsSync(join(mainRepo, "conflict.txt"))).toBe(false);
  });
});

function refExists(cwd: string, ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", ref], { cwd, encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("snapshotMain + restoreMain", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-restore-"));
    mainRepo = join(root, "main");
    wsDir = join(root, "ws");
    mkdirSync(mainRepo, { recursive: true });

    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    git(mainRepo, "config", "core.autocrlf", "false");

    writeFileSync(join(mainRepo, "committed.txt"), "committed v1\n");
    writeFileSync(join(mainRepo, "tracked.txt"), "tracked v1\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");

    git(mainRepo, "worktree", "add", "-b", "feature", wsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("captures an untracked file into originalTree", () => {
    writeFileSync(join(mainRepo, "untracked.txt"), "untracked content\n");

    const snap = snapshotMain(mainRepo);
    const treeFiles = git(mainRepo, "ls-tree", "-r", "--name-only", snap.originalTree).split("\n");

    expect(treeFiles).toContain("untracked.txt");
  });

  it("restores main's branch, working tree, index, and untracked files exactly", () => {
    writeFileSync(join(mainRepo, "tracked.txt"), "tracked v2 UNCOMMITTED\n");
    writeFileSync(join(mainRepo, "staged.txt"), "staged content\n");
    git(mainRepo, "add", "staged.txt");
    writeFileSync(join(mainRepo, "untracked.txt"), "untracked content\n");

    const statusBefore = git(mainRepo, "status", "--porcelain");
    const headBefore = git(mainRepo, "rev-parse", "HEAD");
    const trackedBefore = readFileSync(join(mainRepo, "tracked.txt"), "utf8");
    const stagedBefore = readFileSync(join(mainRepo, "staged.txt"), "utf8");
    const untrackedBefore = readFileSync(join(mainRepo, "untracked.txt"), "utf8");
    const committedBefore = readFileSync(join(mainRepo, "committed.txt"), "utf8");

    const snap = snapshotMain(mainRepo);
    expect(refExists(mainRepo, snap.originalRef)).toBe(true);

    writeFileSync(join(wsDir, "tracked.txt"), "workspace content\n");
    git(wsDir, "commit", "-am", "workspace change");
    writeFileSync(join(wsDir, "marker.txt"), "workspace-only marker\n");
    expect(syncOnce(wsDir, mainRepo)).toBe(true);
    expect(existsSync(join(mainRepo, "marker.txt"))).toBe(true);

    restoreMain(mainRepo, snap.originalHead, snap.originalTree, snap.originalIndexTree, snap.originalRef);

    expect(git(mainRepo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(mainRepo, "status", "--porcelain")).toBe(statusBefore);
    expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe(trackedBefore);
    expect(readFileSync(join(mainRepo, "staged.txt"), "utf8")).toBe(stagedBefore);
    expect(readFileSync(join(mainRepo, "untracked.txt"), "utf8")).toBe(untrackedBefore);
    expect(readFileSync(join(mainRepo, "committed.txt"), "utf8")).toBe(committedBefore);
    expect(existsSync(join(mainRepo, "marker.txt"))).toBe(false);
    expect(refExists(mainRepo, snap.originalRef)).toBe(false);
  });
});

describe("activate + deactivate", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;
  let realHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-title-"));
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

    realHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(async () => {
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the title the workspace had at beam-in so beam-out can restore it", async () => {
    await activate({
      workspaceId: "ws-1",
      workspaceName: "cruel-dolphin",
      workspaceDir: wsDir,
      workspaceTitle: "Checkout rewrite",
    });

    await expect(deactivate()).resolves.toEqual({
      active: false,
      workspaceId: "ws-1",
      originalTitle: "Checkout rewrite",
    });
  });

  it("reports no recorded title for a beam started before titles were tracked", async () => {
    await activate({
      workspaceId: "ws-1",
      workspaceName: "cruel-dolphin",
      workspaceDir: wsDir,
      workspaceTitle: undefined,
    });

    const stateFile = join(mainRepo, ".git", "beam-state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state).not.toHaveProperty("originalTitle");

    await expect(deactivate()).resolves.toEqual({
      active: false,
      workspaceId: "ws-1",
      originalTitle: undefined,
    });
  });
});
