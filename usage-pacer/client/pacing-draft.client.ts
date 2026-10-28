import { type PacingOverrides, pacingDefaults, pacingOverrides } from "../shared/pacing.shared";

export const PACING_KEYS = pacingDefaults.keyof().options;
export type PacingKey = (typeof PACING_KEYS)[number];

// An empty field means the setting is unset, so the guard uses pacing.json.
export type PacingDraft = Record<PacingKey, string>;

export function draftFrom(values: PacingOverrides): PacingDraft {
  return Object.fromEntries(PACING_KEYS.map((key) => [key, values[key]?.toString() ?? ""])) as PacingDraft;
}

export function overridesFrom(draft: PacingDraft): { overrides: PacingOverrides } | { error: string } {
  const filled = PACING_KEYS.filter((key) => draft[key].trim() !== "").map((key) => {
    const text = draft[key].trim();
    return [key, key === "weekly_pace" ? text : Number(text)];
  });
  const parsed = pacingOverrides.safeParse(Object.fromEntries(filled));
  if (parsed.success) return { overrides: parsed.data };
  const [issue] = parsed.error.issues;
  return { error: `${issue.path.join(".")}: ${issue.message}` };
}
