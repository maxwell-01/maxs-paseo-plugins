import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_SHARED_DIR = "/srv/paseo-shared/shared-stack";

const configSchema = z.object({
  // Folder shared by every account's daemon (group-writable).
  sharedDir: z.string().default(DEFAULT_SHARED_DIR),
  // Host daemon only: the checkout the running stack serves. Its presence makes this daemon the host.
  stackCheckout: z.string().optional(),
  // Host daemon only: shown to agents and in the app, for example the stack's local URL.
  stackUrl: z.string().optional(),
});
export type Config = z.infer<typeof configSchema>;

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function pluginDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(expandHome(env.PASEO_HOME ?? "~/.paseo")), "plugin-data", "shared-stack");
}

export function readConfig(dataDir = pluginDataDir()): Config {
  const path = join(dataDir, "config.json");
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const config = configSchema.parse(raw);
  return {
    ...config,
    sharedDir: resolve(expandHome(config.sharedDir)),
    stackCheckout: config.stackCheckout ? resolve(expandHome(config.stackCheckout)) : undefined,
  };
}

// Daemons on one machine are told apart by the account that runs them.
export const daemonName = () => userInfo().username;
