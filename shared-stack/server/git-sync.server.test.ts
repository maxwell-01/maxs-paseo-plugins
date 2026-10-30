import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySnapshot, ensureSharedRepo, hasOriginal, publishSnapshot, restoreOriginal } from "./git-sync.server";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), "shared-stack-git-"));
  const origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "--quiet", "-b", "main");
  writeFileSync(join(origin, "app.txt"), "v1\n");
  writeFileSync(join(origin, "same.txt"), "unchanged\n");
  writeFileSync(join(origin, ".gitignore"), ".env\n");
  git(origin, "add", "-A");
  git(origin, "commit", "--quiet", "-m", "base");
  const stack = join(root, "stack");
  const guest = join(root, "guest");
  git(root, "clone", "--quiet", origin, stack);
  git(root, "clone", "--quiet", origin, guest);
  const shared = join(root, "shared");
  mkdirSync(shared);
  return { root, stack, guest, shared, data: join(root, "data") };
}

describe("git sync", () => {
  it("syncs a guest's working tree onto the stack checkout and restores the checkout afterwards", async () => {
    const { stack, guest, shared, data } = setup();
    mkdirSync(data);
    writeFileSync(join(stack, ".env"), "STACK_SECRET=1\n");
    writeFileSync(join(stack, "local-note.txt"), "stack's own untracked file\n");
    writeFileSync(join(stack, "app.txt"), "stack's own edit\n");
    await ensureSharedRepo(shared, stack);

    git(guest, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(guest, "app.txt"), "v2 committed\n");
    git(guest, "commit", "--quiet", "-am", "feature work");
    writeFileSync(join(guest, "new.txt"), "untracked new file\n");
    writeFileSync(join(guest, ".env"), "GUEST_SECRET=1\n");

    const index = join(data, "index-agent");
    const first = await publishSnapshot({ workspaceDir: guest, indexPath: index, sharedDir: shared, lastTree: null });
    expect(first).not.toBeNull();
    expect(await publishSnapshot({ workspaceDir: guest, indexPath: index, sharedDir: shared, lastTree: first!.tree })).toBeNull();

    const sameMtime = statSync(join(stack, "same.txt")).mtimeMs;
    await applySnapshot({ checkout: stack, sharedDir: shared, commit: first!.commit, indexPath: join(data, "index-original") });
    expect(readFileSync(join(stack, "app.txt"), "utf8")).toBe("v2 committed\n");
    expect(readFileSync(join(stack, "new.txt"), "utf8")).toBe("untracked new file\n");
    expect(readFileSync(join(stack, ".env"), "utf8")).toBe("STACK_SECRET=1\n");
    expect(statSync(join(stack, "same.txt")).mtimeMs).toBe(sameMtime);
    expect(git(stack, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");

    writeFileSync(join(guest, "app.txt"), "v3 uncommitted\n");
    const second = await publishSnapshot({ workspaceDir: guest, indexPath: index, sharedDir: shared, lastTree: first!.tree });
    await applySnapshot({ checkout: stack, sharedDir: shared, commit: second!.commit, indexPath: join(data, "index-original") });
    expect(readFileSync(join(stack, "app.txt"), "utf8")).toBe("v3 uncommitted\n");

    await restoreOriginal(stack);
    expect(readFileSync(join(stack, "app.txt"), "utf8")).toBe("stack's own edit\n");
    expect(readFileSync(join(stack, "local-note.txt"), "utf8")).toBe("stack's own untracked file\n");
    expect(existsSync(join(stack, "new.txt"))).toBe(false);
    expect(git(stack, "status", "--porcelain")).toBe("M app.txt\n?? local-note.txt");
    expect(await hasOriginal(stack)).toBe(false);
  });
});
