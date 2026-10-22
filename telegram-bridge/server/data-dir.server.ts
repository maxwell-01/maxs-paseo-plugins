import { homedir } from "node:os";
import { join, resolve } from "node:path";

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function paseoHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(expandHome(env.PASEO_HOME ?? "~/.paseo"));
}

export function bridgeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(paseoHome(env), "plugin-data", "telegram-bridge");
}
