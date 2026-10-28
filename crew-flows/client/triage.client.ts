import type { LiveAgent, Run } from "../shared/teams.shared";
import { type Crewmate, crewOf, readStateLine } from "./crew.client";
import { runState } from "./teams.client";

const WAITING_STATES = new Set(["needs-decision", "blocked", "failed"]);

export interface Triage {
  mate: LiveAgent | null;
  crew: Crewmate[];
  needsYou: Crewmate[];
  running: Crewmate[];
  doneOrIdle: Crewmate[];
  liveRuns: Run[];
  recentRuns: Run[];
}

// A running agent has started a new turn, so the state line it ended its last turn with is out of date.
const isWaiting = ({ agent, state }: Crewmate) => agent.status !== "running" && state !== null && WAITING_STATES.has(state);

export function triage(agents: LiveAgent[], runs: Run[], now: number): Triage {
  const { mate, crew } = crewOf(agents);
  const needsYou = agents.flatMap((agent) => {
    if (agent.needsYou) return [readStateLine(agent)];
    const member = crew.find((m) => m.agent === agent);
    return member && isWaiting(member) ? [member] : [];
  });
  const others = crew.filter((member) => !needsYou.some((m) => m.agent === member.agent));
  return {
    mate,
    crew,
    needsYou,
    running: others.filter((member) => member.agent.status === "running"),
    doneOrIdle: others.filter((member) => member.agent.status !== "running"),
    liveRuns: runs.filter((run) => runState(run, now) === "live"),
    recentRuns: runs.filter((run) => runState(run, now) !== "live"),
  };
}
