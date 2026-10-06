import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFlows } from "./server/flows.server";
import { liveAgentsLabelled } from "./server/live-agents.server";
import { readRuns } from "./server/runs.server";
import { listFlows } from "./shared/flows.shared";
import { listTeams } from "./shared/teams.shared";

const SOURCES = {
  roots: ["/workspace"],
  // The marketplace checkout is the copy update.sh keeps current, so it holds the briefs loop.py runs.
  skillDir: join(homedir(), ".claude/plugins/marketplaces/max-personal/claudeConfig/skills/ticket-loop"),
};
// Where loop.py's manifests put run_dir, and so its <run_dir>-state.
const STATE_ROOT = "/workspace/.ticket-loop";
const TEAM_LABELS = ["ticket-loop."];

export default function contribute(server: PluginServerContext) {
  server.handle(listFlows, () => readFlows(SOURCES));
  server.handle(listTeams, async (_input, { paseo }) => {
    const [{ runs, problems }, agents] = await Promise.all([readRuns(STATE_ROOT), liveAgentsLabelled(paseo, TEAM_LABELS)]);
    return { runs, agents, problems };
  });
  return () => {};
}
