import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const briefSchema = z.object({
  ref: z.string(),
  words: z.number(),
  outcome: z.string(),
  checks: z.array(z.string()),
});

export const stageSchema = z.object({
  id: z.string(),
  model: z.string(),
  thinking: z.string(),
  persist: z.boolean(),
  always: z.boolean(),
  reviews: z.string().nullable(),
  // Declared by gsmail's manifest but ignored by loop.py, so the UI flags them as not enforced.
  ownerApproves: z.boolean(),
  asks: z.string().nullable(),
  brief: briefSchema.nullable(),
});

export const queueSchema = z.object({
  repo: z.string(),
  labels: z.array(z.string()),
  excludeLabels: z.array(z.string()),
  order: z.string().nullable(),
  maxTickets: z.number().nullable(),
});

export const flowSchema = z.object({
  name: z.string(),
  repoDir: z.string(),
  remote: z.string().nullable(),
  manifestPath: z.string(),
  maxRounds: z.number(),
  stallSeconds: z.number(),
  queue: queueSchema.nullable(),
  stages: z.array(stageSchema),
});

export const listFlows = defineRpc({
  name: "flows.list",
  input: z.object({}),
  output: z.object({
    flows: z.array(flowSchema),
    craftWords: z.number().nullable(),
    problems: z.array(z.string()),
  }),
});

export type Brief = z.infer<typeof briefSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type FlowList = z.infer<typeof listFlows.output>;
