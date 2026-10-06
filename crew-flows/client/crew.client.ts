import type { LiveAgent } from "../shared/teams.shared";

// FirstMate's charter: a crewmate ends every turn with `<state>: <one short line>`.
const STATE_LINE = /^(working|needs-decision|blocked|paused|done|failed|resolved):\s*(.*)$/;

export interface Crewmate {
  agent: LiveAgent;
  state: string | null;
  line: string | null;
}

export function crewOf(agents: LiveAgent[]): { mate: LiveAgent | null; crew: Crewmate[] } {
  const mate = agents.find((agent) => agent.labels["firstmate.role"] === "first-mate") ?? null;
  const crew = agents
    .filter((agent) => agent.labels["firstmate.role"] === "crew" && !agent.labels["ticket-loop.run"])
    .map((agent) => {
      const last = agent.lastSaid?.trim().split("\n").at(-1)?.trim() ?? null;
      const match = last ? STATE_LINE.exec(last) : null;
      return { agent, state: match?.[1] ?? null, line: match?.[2] ?? last };
    });
  return { mate, crew };
}
