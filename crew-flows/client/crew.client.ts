import type { LiveAgent } from "../shared/teams.shared";

// FirstMate's charter: a crewmate ends every turn with `<state>: <one short line>`.
const STATE_LINE = /^(working|needs-decision|blocked|paused|done|failed|resolved):\s*(.*)$/;

export interface Crewmate {
  agent: LiveAgent;
  state: string | null;
  line: string | null;
}

// Under --subscription-guard loop.py labels its agents as crew too; runs from before the
// ticket-loop.run label carry only this task.
const isLoopAgent = (agent: LiveAgent) =>
  Boolean(agent.labels["ticket-loop.run"]) || (agent.labels["firstmate.task"] ?? "").startsWith("ticket-loop:");

const WAITING_STATES = new Set(["needs-decision", "blocked"]);

export function waitingOnYou(agents: LiveAgent[], crew: Crewmate[]): LiveAgent[] {
  return agents.filter((agent) => agent.needsYou
    || crew.some((mate) => mate.agent === agent && mate.state !== null && WAITING_STATES.has(mate.state)));
}

export function crewOf(agents: LiveAgent[]): { mate: LiveAgent | null; crew: Crewmate[] } {
  const mate = agents.find((agent) => agent.labels["firstmate.role"] === "first-mate") ?? null;
  const crew = agents
    .filter((agent) => agent.labels["firstmate.role"] === "crew" && !isLoopAgent(agent)
      // FirstMate's own test for its crew: an agent a crewmate starts inherits the crew labels.
      && (mate === null || agent.labels["paseo.parent-agent-id"] === mate.id))
    .map((agent) => {
      const last = agent.lastSaid?.trim().split("\n").at(-1)?.trim() ?? null;
      const match = last ? STATE_LINE.exec(last) : null;
      return { agent, state: match?.[1] ?? null, line: match?.[2] ?? last };
    });
  return { mate, crew };
}
