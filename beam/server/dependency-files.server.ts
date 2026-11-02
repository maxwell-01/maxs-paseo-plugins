import { execFileSync } from "node:child_process";

const DEPENDENCY_FILE_NAMES = new Set([
  "package.json",
  "npm-shrinkwrap.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "go.sum",
  "go.work",
  "Gemfile",
  "composer.json",
  "Package.resolved",
  "pubspec.yaml",
  "mix.exs",
]);
const INSTALLED_PACKAGE_DIRS = ["node_modules", "vendor"];
const LOCKFILE_NAME = /(?:^|[.-])lock(?:b|file)?(?:\.(?:json|ya?ml))?$/i;
const REQUIREMENTS_NAME = /^requirements.*\.txt$/i;

export function isDependencyFile(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => INSTALLED_PACKAGE_DIRS.includes(segment))) {
    return false;
  }
  const name = segments[segments.length - 1] ?? "";
  return DEPENDENCY_FILE_NAMES.has(name) || LOCKFILE_NAME.test(name) || REQUIREMENTS_NAME.test(name);
}

export function changedDependencyFiles(repo: string, fromTree: string, toTree: string): string[] {
  const changed = execFileSync("git", ["diff-tree", "-r", "--name-only", "--no-renames", "-z", fromTree, toTree], {
    cwd: repo,
    encoding: "utf8",
  });
  return changed.split("\0").filter((path) => path.length > 0 && isDependencyFile(path)).sort();
}
