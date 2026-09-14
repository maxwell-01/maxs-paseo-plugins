import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const beamStatus = defineRpc({
  name: "beam.status",
  input: z.object({}),
  output: z.object({
    active: z.boolean(),
    workspaceId: z.string().optional(),
    mainPath: z.string(),
    originalBranch: z.string().optional(),
    originalHead: z.string().optional(),
    lastSyncAt: z.string().optional(),
  }),
});

export const beamActivate = defineRpc({
  name: "beam.activate",
  input: z.object({ workspaceId: z.string(), workspaceDir: z.string() }),
  output: z.object({ active: z.literal(true), mainPath: z.string() }),
});

export const beamDeactivate = defineRpc({
  name: "beam.deactivate",
  input: z.object({}),
  output: z.object({ active: z.literal(false) }),
});

export const beamLog = defineRpc({
  name: "beam.log",
  input: z.object({}),
  output: z.object({
    entries: z.array(
      z.object({
        ts: z.string(),
        level: z.enum(["info", "warn", "error"]),
        message: z.string(),
      }),
    ),
  }),
});
