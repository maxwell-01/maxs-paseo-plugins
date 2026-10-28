import { homedir } from "node:os";
import { join, resolve } from "node:path";

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function firstMateHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(expandHome(env.PASEO_HOME ?? "~/.paseo")), "plugin-data", "firstmate", "home");
}

// install.py links this into the host's myStuff clone, which the guard's watch keeps on main.
export function guardFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(guardData(env), "assets", "guard.py");
}

export function pacingOverridesFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(guardData(env), "pacing-overrides.json");
}

function guardData(env: NodeJS.ProcessEnv): string {
  return join(firstMateHome(env), "data", "subscription-usage-watch");
}
