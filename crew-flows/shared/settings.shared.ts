import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const sources = defineSettings({
  id: "sources",
  scope: "host",
  version: 1,
  schema: z.object({
    // Empty means this host's Paseo projects.
    repoRoots: z.array(z.string().min(1)).default([]),
    // Where the crewFlows manager writes each run's state folder.
    stateRoot: z.string().min(1).default("~/.crew-flows"),
    // The marketplace checkout is the copy update.sh keeps current, so it holds the briefs loop.py runs.
    skillDir: z.string().min(1).default("~/.claude/plugins/marketplaces/max-personal/claudeConfig/skills/crew-flows"),
  }),
});
