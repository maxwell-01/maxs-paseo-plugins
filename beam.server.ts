import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { z } from "zod";

const SYNC_DEBOUNCE_MS = 200;

const BeamStateSchema = z.object({
  workspaceId: z.string(),
  workspaceDir: z.string(),
  mainPath: z.string(),
  originalBranch: z.string(),
  originalHead: z.string(),
  startedAt: z.string(),
});
type BeamState = z.infer<typeof BeamStateSchema>;

const PointerSchema = z.object({ mainPath: z.string() });

interface ActiveBeam {
  workspaceDir: string;
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  queued: boolean;
  lastSyncAt: string | null;
}

const activeBeams = new Map<string, ActiveBeam>();

let tempIndexCounter = 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitWithEnv(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function gitSucceeds(cwd: string, ...args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pointerPath(): string {
  return join(homedir(), ".paseo-beam-active.json");
}

function stateFilePath(mainPath: string): string {
  return join(mainPath, ".git", "beam-state.json");
}

function readState(file: string): BeamState {
  return BeamStateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function readPointer(file: string): { mainPath: string } {
  return PointerSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function resolveMainPath(workspaceDir: string): string {
  const porcelain = git(workspaceDir, "worktree", "list", "--porcelain");
  const firstWorktree = porcelain.split("\n").find((line) => line.startsWith("worktree "));
  if (!firstWorktree) {
    throw new Error(`could not resolve the main checkout from git worktree list in ${workspaceDir}`);
  }
  return firstWorktree.slice("worktree ".length).trim();
}

function shouldIgnorePath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  if (
    segments.includes(".git") ||
    segments.includes("node_modules") ||
    segments.includes(".context")
  ) {
    return true;
  }
  const filename = segments[segments.length - 1] ?? "";
  return filename.includes(".tmp.");
}

function hasRebaseInProgress(repo: string): boolean {
  const rebaseMerge = git(repo, "rev-parse", "--git-path", "rebase-merge");
  const rebaseApply = git(repo, "rev-parse", "--git-path", "rebase-apply");
  return existsSync(resolve(repo, rebaseMerge)) || existsSync(resolve(repo, rebaseApply));
}

export function midOperationReason(repo: string): string | null {
  if (gitSucceeds(repo, "rev-parse", "-q", "--verify", "MERGE_HEAD")) {
    return `merge in progress in ${repo}`;
  }
  if (hasRebaseInProgress(repo)) {
    return `rebase in progress in ${repo}`;
  }
  if (git(repo, "diff", "--name-only", "--diff-filter=U").length > 0) {
    return `unmerged index entries in ${repo}`;
  }
  return null;
}

export function syncOnce(workspaceDir: string, mainPath: string): boolean {
  const blocked = midOperationReason(workspaceDir) ?? midOperationReason(mainPath);
  if (blocked) {
    console.error(`beam sync skipped: ${blocked}`);
    return false;
  }

  const wsHead = git(workspaceDir, "rev-parse", "HEAD");

  const tmpIndex = join(tmpdir(), `beam-index-${process.pid}-${tempIndexCounter++}`);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  let snapTree: string;
  try {
    gitWithEnv(workspaceDir, env, "read-tree", "HEAD");
    gitWithEnv(workspaceDir, env, "add", "-A");
    snapTree = gitWithEnv(workspaceDir, env, "write-tree");
  } finally {
    if (existsSync(tmpIndex)) {
      rmSync(tmpIndex);
    }
  }

  git(mainPath, "reset", "--mixed", wsHead);
  git(mainPath, "read-tree", "--reset", "-u", snapTree);
  git(mainPath, "clean", "-fd");

  return true;
}

function sync(workspaceDir: string, mainPath: string): void {
  try {
    if (!syncOnce(workspaceDir, mainPath)) {
      return;
    }
    const entry = activeBeams.get(mainPath);
    if (entry) {
      entry.lastSyncAt = new Date().toISOString();
    }
  } catch (error) {
    console.error("beam sync failed:", error instanceof Error ? error.message : error);
  }
}

function runSyncLoop(mainPath: string): void {
  const entry = activeBeams.get(mainPath);
  if (!entry || entry.running) {
    return;
  }
  entry.running = true;
  try {
    sync(entry.workspaceDir, mainPath);
  } finally {
    entry.running = false;
    if (entry.queued) {
      entry.queued = false;
      runSyncLoop(mainPath);
    }
  }
}

function scheduleSync(mainPath: string): void {
  const entry = activeBeams.get(mainPath);
  if (!entry) {
    return;
  }
  if (entry.running) {
    entry.queued = true;
    return;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    const current = activeBeams.get(mainPath);
    if (current) {
      current.timer = null;
    }
    runSyncLoop(mainPath);
  }, SYNC_DEBOUNCE_MS);
}

function stopBeam(mainPath: string): void {
  const entry = activeBeams.get(mainPath);
  if (!entry) {
    return;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.watcher.close().catch((error) => {
    console.error("beam watcher close failed:", error instanceof Error ? error.message : error);
  });
  activeBeams.delete(mainPath);
}

export function stopAllBeams(): void {
  for (const mainPath of [...activeBeams.keys()]) {
    stopBeam(mainPath);
  }
}

export async function activate(input: {
  workspaceId: string;
  workspaceDir: string;
}): Promise<{ active: true; mainPath: string }> {
  const { workspaceId, workspaceDir } = input;
  const mainPath = resolveMainPath(workspaceDir);

  if (realpathSync(mainPath) === realpathSync(workspaceDir)) {
    throw new Error("cannot beam the main checkout onto itself");
  }

  const stateFile = stateFilePath(mainPath);
  if (activeBeams.has(mainPath) || existsSync(stateFile)) {
    throw new Error(`a beam is already active for ${mainPath}; beam out first`);
  }

  const originalBranch = git(mainPath, "rev-parse", "--abbrev-ref", "HEAD");
  const originalHead = git(mainPath, "rev-parse", "HEAD");

  const watcher = watch(workspaceDir, {
    ignored: (path: string) => shouldIgnorePath(path),
    ignoreInitial: true,
  });
  const entry: ActiveBeam = {
    workspaceDir,
    watcher,
    timer: null,
    running: false,
    queued: false,
    lastSyncAt: null,
  };
  activeBeams.set(mainPath, entry);

  watcher.on("all", () => scheduleSync(mainPath));
  watcher.on("error", (error) => {
    console.error("beam watcher error:", error instanceof Error ? error.message : error);
  });

  runSyncLoop(mainPath);

  const state: BeamState = {
    workspaceId,
    workspaceDir,
    mainPath,
    originalBranch,
    originalHead,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  writeFileSync(pointerPath(), JSON.stringify({ mainPath }, null, 2));

  return { active: true, mainPath };
}

export async function deactivate(): Promise<{ active: false }> {
  const pointer = pointerPath();
  if (!existsSync(pointer)) {
    throw new Error("no active beam");
  }
  const { mainPath } = readPointer(pointer);
  stopBeam(mainPath);

  const stateFile = stateFilePath(mainPath);
  if (existsSync(stateFile)) {
    rmSync(stateFile);
  }
  rmSync(pointer);

  return { active: false };
}

export async function status(): Promise<{
  active: boolean;
  workspaceId?: string;
  mainPath: string;
  originalBranch?: string;
  originalHead?: string;
  lastSyncAt?: string;
}> {
  const pointer = pointerPath();
  if (!existsSync(pointer)) {
    return { active: false, mainPath: "" };
  }
  const { mainPath } = readPointer(pointer);
  const stateFile = stateFilePath(mainPath);
  if (!existsSync(stateFile)) {
    return { active: false, mainPath: "" };
  }
  const state = readState(stateFile);
  const lastSyncAt = activeBeams.get(mainPath)?.lastSyncAt ?? undefined;
  return {
    active: true,
    workspaceId: state.workspaceId,
    mainPath,
    originalBranch: state.originalBranch,
    originalHead: state.originalHead,
    lastSyncAt,
  };
}
