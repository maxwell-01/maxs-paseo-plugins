import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const sources = defineSettings({
  id: "sources",
  scope: "host",
  version: 1,
  schema: z.object({
    repoRoots: z.array(z.string()).default(["/workspace"]),
    stateRoot: z.string().default("/workspace/.ticket-loop"),
    // The marketplace checkout is the copy update.sh keeps current, so it holds the briefs loop.py runs.
    skillDir: z.string().default("~/.claude/plugins/marketplaces/max-personal/claudeConfig/skills/ticket-loop"),
  }),
});
