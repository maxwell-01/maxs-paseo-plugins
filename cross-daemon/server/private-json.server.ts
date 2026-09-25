import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";

const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;

export function readPrivateJson<Schema extends z.ZodType>(file: string, schema: Schema, empty: z.output<Schema>): z.output<Schema> {
  if (!existsSync(file)) return empty;
  return schema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function writePrivateJson(file: string, value: unknown): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
  chmodSync(dir, OWNER_ONLY_DIR);
  const staging = `${file}.${randomUUID()}.tmp`;
  writeFileSync(staging, JSON.stringify(value, null, 2), { mode: OWNER_ONLY_FILE, flag: "wx" });
  renameSync(staging, file);
}
