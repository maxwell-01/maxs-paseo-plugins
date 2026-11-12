import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type PacingDefaults, type PacingOverrides, pacingDefaults } from "../shared/pacing.shared";
import { guardFiles } from "./guard-files.generated";

export function pacingDefaultsFrom(): PacingDefaults {
  const parsed: unknown = JSON.parse(guardFiles["pacing.json"]);
  return pacingDefaults.parse(parsed);
}

export async function writePacingOverrides(file: string, overrides: PacingOverrides): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(overrides));
  await rename(temp, file);
}
