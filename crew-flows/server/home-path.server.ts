import { homedir } from "node:os";
import { join } from "node:path";

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}
