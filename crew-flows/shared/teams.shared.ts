import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const runStageSchema = z.object({
  id: z.string(),
  reviews: z.string().nullable(),
  persist: z.boolean(),
  always: z.boolean(),
  model: z.string(),
});

export const runSchema = z.object({
  stateDir: z.string(),
  name: z.string(),
  runId: z.string(),
  issue: z.string().nullable(),
  stage: z.string().nullable(),
  round: z.number().nullable(),
  beaconAt: z.string().nullable(),
  outcome: z.string().nullable(),
  manifestPath: z.string().nullable(),
  // Null for a run whose beacon predates the manifest path; the UI falls back to the repo's flow.
  stages: z.array(runStageSchema).nullable(),
  agents: z.record(z.string(), z.string()),
  verdicts: z.array(z.object({ stage: z.string(), round: z.number(), verdict: z.string(), findings: z.number() })),
  // Null when nothing wrote a loop.log: loop.py prints to stdout, and only a queue or a shell redirect keeps it.
  logTail: z.array(z.string()).nullable(),
});

export const liveAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  model: z.string().nullable(),
  // A permission request or an error. Paseo also flags every finished turn, which is not a call for help.
  needsYou: z.boolean(),
  labels: z.record(z.string(), z.string()),
  updatedAt: z.string(),
  lastSaid: z.string().nullable(),
});

export const listTeams = defineRpc({
  name: "teams.list",
  input: z.object({}),
  output: z.object({ runs: z.array(runSchema), agents: z.array(liveAgentSchema), problems: z.array(z.string()) }),
});

export type Run = z.infer<typeof runSchema>;
export type LiveAgent = z.infer<typeof liveAgentSchema>;
export type Teams = z.infer<typeof listTeams.output>;
