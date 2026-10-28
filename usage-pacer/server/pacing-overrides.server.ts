import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type PacingDefaults, type PacingOverrides, pacingDefaults } from "../shared/pacing.shared";

// install.py links the myStuff claudeConfig beside the guard; policy.py reads the same pacing.json.
export function pacingDefaultsFrom(guard: string): PacingDefaults {
  const file = join(dirname(guard), "claudeConfig", "skills", "paced-workflows", "config", "pacing.json");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return pacingDefaults.parse(parsed);
}

export async function writePacingOverrides(file: string, overrides: PacingOverrides): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(overrides));
  await rename(temp, file);
}
