import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const percent = z.number().min(0).max(100);
const weeklyPace = z.enum(["working_week", "whole_week"]);

// Keys match pacing.json, so a saved value is written to the guard's overrides file unchanged.
const pacingValues = {
  weekly_target_pct: percent,
  contingency_5h_pct: percent,
  contingency_7d_pct: percent,
  emergency_5h_pct: percent,
  emergency_7d_pct: percent,
  stop_pct: percent,
  up_margin_pct: percent,
  max_concurrency: z.number().int().min(1),
  weekly_pace: weeklyPace,
};

export const pacingDefaults = z.object(pacingValues);
export type PacingDefaults = z.infer<typeof pacingDefaults>;

export const pacingOverrides = pacingDefaults.partial();
export type PacingOverrides = z.infer<typeof pacingOverrides>;

export const pacingSettings = defineSettings({ id: "pacing", scope: "host", version: 1, schema: pacingOverrides });

export const readPacingDefaults = defineRpc({
  name: "pacing.defaults",
  input: z.object({}),
  output: pacingDefaults,
});
