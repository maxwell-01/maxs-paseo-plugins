import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const OWNER_ONLY_DIR = 0o700;
export const OWNER_ONLY_FILE = 0o600;

export function writeFileAtomically(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: OWNER_ONLY_DIR });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, content, { mode });
  renameSync(staging, path);
}
