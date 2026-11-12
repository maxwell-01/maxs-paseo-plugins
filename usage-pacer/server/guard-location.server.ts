import { homedir } from "node:os";
import { join, resolve } from "node:path";

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(expandHome(env.PASEO_HOME ?? "~/.paseo")), "plugin-data", "usage-pacer");
}

export function guardFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), "guard", "guard.py");
}

export function pacingOverridesFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), "pacing-overrides.json");
}
