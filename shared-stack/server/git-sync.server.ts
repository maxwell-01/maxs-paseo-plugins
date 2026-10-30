import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const HOLDER_REF = "refs/shared-stack/holder";
const ORIGINAL_REF = "refs/shared-stack/original";
const IDENTITY = {
  GIT_AUTHOR_NAME: "shared-stack",
  GIT_AUTHOR_EMAIL: "shared-stack@localhost",
  GIT_COMMITTER_NAME: "shared-stack",
  GIT_COMMITTER_EMAIL: "shared-stack@localhost",
};

export const sharedRepoPath = (sharedDir: string) => join(sharedDir, "repo.git");

// Git refuses a repository owned by another account unless it is a safe.directory. Configuration
// passed through the environment counts as command-line configuration, which Git trusts for this.
const trusting = (repo: string): NodeJS.ProcessEnv => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: repo });

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args[0]} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

// The tree of the full working tree, untracked files included and ignored files left out. The
// private index keeps stat data between calls, so later calls only hash files that changed.
async function workingTree(dir: string, indexPath: string): Promise<string> {
  const env = { GIT_INDEX_FILE: indexPath };
  if (!existsSync(indexPath)) await git(dir, ["read-tree", "HEAD"], env);
  await git(dir, ["add", "-A"], env);
  return git(dir, ["write-tree"], env);
}

export async function ensureSharedRepo(sharedDir: string, seedFrom: string): Promise<void> {
  const repo = sharedRepoPath(sharedDir);
  if (existsSync(join(repo, "HEAD"))) return;
  await git(sharedDir, ["init", "--quiet", "--bare", "--shared=group", repo]);
  // Seed the history every checkout shares, so a guest's first push only sends its own commits.
  const base = (await gitSucceeds(seedFrom, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/HEAD"])) ? "refs/remotes/origin/HEAD" : "HEAD";
  await git(seedFrom, ["push", "--quiet", "--no-verify", repo, `${base}:refs/heads/base`], trusting(repo));
}

// Holder's daemon: publish the workspace's working tree if it changed since `lastTree`.
export async function publishSnapshot(options: {
  workspaceDir: string;
  indexPath: string;
  sharedDir: string;
  lastTree: string | null;
}): Promise<{ commit: string; tree: string } | null> {
  const tree = await workingTree(options.workspaceDir, options.indexPath);
  if (tree === options.lastTree) return null;
  const head = await git(options.workspaceDir, ["rev-parse", "HEAD"]);
  const commit = await git(options.workspaceDir, ["commit-tree", tree, "-p", head, "-m", "shared-stack snapshot"], IDENTITY);
  const repo = sharedRepoPath(options.sharedDir);
  await git(options.workspaceDir, ["push", "--quiet", "--force", "--no-verify", repo, `${commit}:${HOLDER_REF}`], trusting(repo));
  return { commit, tree };
}

export const forgetSnapshotIndex = (indexPath: string) => rmSync(indexPath, { force: true });

export async function currentBranch(dir: string): Promise<string | null> {
  try {
    const branch = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

// Saves the checkout's own state before the first holder's tree lands: working tree (untracked
// files included), index, and HEAD, as a chain of commits under ORIGINAL_REF.
async function saveOriginal(checkout: string, indexPath: string): Promise<void> {
  if (await gitSucceeds(checkout, ["rev-parse", "--verify", "--quiet", ORIGINAL_REF])) return;
  forgetSnapshotIndex(indexPath);
  const worktreeTree = await workingTree(checkout, indexPath);
  forgetSnapshotIndex(indexPath);
  const indexTree = await git(checkout, ["write-tree"]);
  const head = await git(checkout, ["rev-parse", "HEAD"]);
  const indexCommit = await git(checkout, ["commit-tree", indexTree, "-p", head, "-m", "shared-stack: original index"], IDENTITY);
  const snapshot = await git(checkout, ["commit-tree", worktreeTree, "-p", indexCommit, "-m", "shared-stack: original working tree"], IDENTITY);
  await git(checkout, ["update-ref", ORIGINAL_REF, snapshot]);
}

// Host: show `commit`'s tree in the checkout. read-tree only rewrites files whose content differs,
// so the stack's file watchers see real changes only.
export async function applySnapshot(options: { checkout: string; sharedDir: string; commit: string; indexPath: string }): Promise<void> {
  const repo = sharedRepoPath(options.sharedDir);
  await git(options.checkout, ["fetch", "--quiet", "--no-tags", repo, HOLDER_REF], trusting(repo));
  if (!(await gitSucceeds(options.checkout, ["cat-file", "-e", `${options.commit}^{commit}`]))) {
    throw new Error(`snapshot ${options.commit} is not in the shared repo yet`);
  }
  await saveOriginal(options.checkout, options.indexPath);
  await git(options.checkout, ["read-tree", "--reset", "-u", `${options.commit}^{tree}`]);
}

export async function hasOriginal(checkout: string): Promise<boolean> {
  return gitSucceeds(checkout, ["rev-parse", "--verify", "--quiet", ORIGINAL_REF]);
}

// Host: put the checkout back as it was before the first holder.
export async function restoreOriginal(checkout: string): Promise<void> {
  if (!(await hasOriginal(checkout))) return;
  await git(checkout, ["read-tree", "--reset", "-u", `${ORIGINAL_REF}^{tree}`]);
  await git(checkout, ["read-tree", `${ORIGINAL_REF}^^{tree}`]);
  await git(checkout, ["update-ref", "-d", ORIGINAL_REF]);
}
