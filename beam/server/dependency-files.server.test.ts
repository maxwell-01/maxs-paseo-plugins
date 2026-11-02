import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedDependencyFiles, isDependencyFile } from "./dependency-files.server";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("isDependencyFile", () => {
  it.each([
    "package.json",
    "apps/api-gateway/package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "deno.lock",
    "requirements.txt",
    "services/ml/requirements-dev.txt",
    "pyproject.toml",
    "poetry.lock",
    "uv.lock",
    "Pipfile",
    "Pipfile.lock",
    "Cargo.toml",
    "crates/core/Cargo.lock",
    "go.mod",
    "go.sum",
    "go.work",
    "Gemfile",
    "Gemfile.lock",
    "composer.json",
    "composer.lock",
    "flake.lock",
    "gradle.lockfile",
    "Package.resolved",
    "pubspec.yaml",
    "mix.exs",
  ])("treats %s as a dependency file", (path) => {
    expect(isDependencyFile(path)).toBe(true);
  });

  it.each(["src/clock.ts", "block.json", "README.md", "package.ts", "docs/requirements.md", "lockfile-notes.txt"])(
    "does not treat %s as a dependency file",
    (path) => {
      expect(isDependencyFile(path)).toBe(false);
    },
  );
});

describe("changedDependencyFiles", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "beam-deps-"));
    git(repo, "init", "-b", "main");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function treeOf(files: Record<string, string>): string {
    git(repo, "rm", "-rq", "--cached", "--ignore-unmatch", ".");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
      git(repo, "add", path);
    }
    return git(repo, "write-tree");
  }

  it("lists the dependency files that were added, changed or deleted, at any depth", () => {
    const before = treeOf({ "package.json": "{}", "apps/api/package.json": "{}", "go.sum": "x", "src/a.ts": "1" });
    const after = treeOf({ "package.json": '{"dependencies":{"zod":"4"}}', "apps/api/package.json": "{}", "bun.lock": "x", "src/a.ts": "2" });

    expect(changedDependencyFiles(repo, before, after)).toEqual(["bun.lock", "go.sum", "package.json"]);
  });

  it("lists nothing when only source files changed", () => {
    const before = treeOf({ "package.json": "{}", "src/a.ts": "1" });
    const after = treeOf({ "package.json": "{}", "src/a.ts": "2" });

    expect(changedDependencyFiles(repo, before, after)).toEqual([]);
  });

  it("ignores dependency files of installed or vendored packages", () => {
    const before = treeOf({ "node_modules/zod/package.json": "1", "vendor/acme/log/composer.json": "1" });
    const after = treeOf({ "node_modules/zod/package.json": "2", "vendor/acme/log/composer.json": "2" });

    expect(changedDependencyFiles(repo, before, after)).toEqual([]);
  });
});
