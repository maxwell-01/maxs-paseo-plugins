import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Manifest, ManifestStage } from "./flows.server";

const roleDefaultsSchema = z.record(z.string(), z.object({
  model: z.string().optional(),
  thinking: z.string().optional(),
  persist: z.boolean().optional(),
}));

export type RoleDefaults = z.infer<typeof roleDefaultsSchema>;

const defaultsPath = (skillDir: string) => join(skillDir, "roles", "defaults.json");

// Null when the skill folder has none, or none that parses: only a stage that takes a role needs them.
export async function readRoleDefaults(skillDir: string, problems: string[]): Promise<RoleDefaults | null> {
  const path = defaultsPath(skillDir);
  if (!existsSync(path)) return null;
  try {
    return roleDefaultsSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// As loop.py's load(): a stage with no brief runs the shared role named by `role`, or by its id.
// The stage's own keys beat the role's defaults, which beat the manifest's.
export function stageSetup(stage: ManifestStage, manifest: Manifest, roles: RoleDefaults | null, skillDir: string) {
  if (stage.brief !== undefined) {
    return { briefRef: stage.brief, model: stage.model ?? manifest.model, thinking: stage.thinking ?? manifest.thinking, persist: stage.persist ?? true };
  }
  if (roles === null) throw new Error(`${manifest.name} ${stage.id}: role defaults ${defaultsPath(skillDir)} not found or not readable`);
  const role = stage.role ?? stage.id;
  const roleDefaults = roles[role] ?? {};
  return {
    briefRef: `skill:roles/${role}.md`,
    model: stage.model ?? roleDefaults.model ?? manifest.model,
    thinking: stage.thinking ?? roleDefaults.thinking ?? manifest.thinking,
    persist: stage.persist ?? roleDefaults.persist ?? true,
  };
}
