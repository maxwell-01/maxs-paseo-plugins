import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFlows } from "./server/flows.server";
import { expandHome } from "./server/home-path.server";
import { liveAgentsLabelled } from "./server/live-agents.server";
import { readRuns } from "./server/runs.server";
import { listFlows } from "./shared/flows.shared";
import { sources } from "./shared/settings.shared";
import { listTeams } from "./shared/teams.shared";

const TEAM_LABELS = ["ticket-loop.", "firstmate."];

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(sources);
  async function readSources() {
    const current = await settings.read();
    if (current.status !== "ready") throw new Error(`Crew & Flows settings are invalid: ${current.error}`);
    const { repoRoots, stateRoot, skillDir } = current.values;
    return { roots: repoRoots.map(expandHome), stateRoot: expandHome(stateRoot), skillDir: expandHome(skillDir) };
  }
  server.handle(listFlows, async () => readFlows(await readSources()));
  server.handle(listTeams, async (_input, { paseo }) => {
    const [runs, live] = await Promise.all([
      readSources().then(({ stateRoot }) => readRuns(stateRoot)),
      liveAgentsLabelled(paseo, TEAM_LABELS),
    ]);
    return { runs: runs.runs, agents: live.agents, problems: [...runs.problems, ...live.problems] };
  });
  return () => {};
}
