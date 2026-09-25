import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRepoKey, parseRepoKey } from "./repo-key.server";

describe("parseRepoKey", () => {
  it.each([
    ["https://github.com/maxwell-01/myStuff.git", "github.com/maxwell-01/mystuff"],
    ["https://github.com/maxwell-01/myStuff", "github.com/maxwell-01/mystuff"],
    ["https://token@github.com/maxwell-01/myStuff.git", "github.com/maxwell-01/mystuff"],
    ["git@github.com:maxwell-01/myStuff.git", "github.com/maxwell-01/mystuff"],
    ["ssh://git@gitlab.example.com:2222/group/sub/app.git", "gitlab.example.com/group/sub/app"],
    ["https://github.com/maxwell-01/myStuff/", "github.com/maxwell-01/mystuff"],
  ])("gives %s the key %s, so every clone of one repo shares its notes", (url, key) => {
    expect(parseRepoKey(url)).toBe(key);
  });

  it("gives one key whatever the letter case, because GitHub ignores case in owner and repo names", () => {
    expect(parseRepoKey("https://GitHub.com/Maxwell-01/MYSTUFF.git")).toBe(parseRepoKey("git@github.com:maxwell-01/myStuff.git"));
  });

  it.each(["/srv/git/app.git", "https://github.com/only-owner", "file:///srv/git/app.git", "git@github.com:a/..", ""])(
    "gives no key for %j, which has no host and repo or could leave the notes folder",
    (url) => {
      expect(parseRepoKey(url)).toBeNull();
    },
  );
});

describe("readRepoKey", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-notes-"));
    dirs.push(dir);
    return dir;
  }

  function makeRepo(remote?: string): string {
    const dir = tempDir();
    execFileSync("git", ["init", "-q", dir]);
    if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
    return dir;
  }

  it("reads the key from the origin remote of a real clone", async () => {
    const repo = makeRepo("git@github.com:maxwell-01/myStuff.git");
    expect(await readRepoKey(repo)).toBe("github.com/maxwell-01/mystuff");
  });

  it("reads the same key inside a worktree of that clone", async () => {
    const repo = makeRepo("git@github.com:maxwell-01/myStuff.git");
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    const worktree = join(repo, "wt");
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", worktree]);
    expect(await readRepoKey(worktree)).toBe("github.com/maxwell-01/mystuff");
  });

  it("gives no key for a repo without an origin remote", async () => {
    expect(await readRepoKey(makeRepo())).toBeNull();
  });

  it("gives no key for a folder that is not a repo", async () => {
    expect(await readRepoKey(tempDir())).toBeNull();
  });
});
