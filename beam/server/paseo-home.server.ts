import { homedir } from "node:os";
import { join, resolve } from "node:path";

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function beamStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(expandHome(env.PASEO_HOME ?? "~/.paseo")), "plugin-data", "beam");
}
