import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { LiveAgent } from "../shared/teams.shared";

type Paseo = PluginHandlerContext["paseo"];
type TimelineItem = { type: string; text?: string };

const PAGE_SIZE = 200;
const TIMELINE_TAIL = 30;

// After FirstMate's closingText (MIT): a streamed reply can arrive as several items.
export function lastSaid(items: readonly TimelineItem[]): string | null {
  const parts: string[] = [];
  for (const item of [...items].reverse()) {
    if (item.type === "assistant_message") parts.unshift(item.text ?? "");
    else if (item.type !== "plugin" && item.type !== "notification") break;
  }
  const text = parts.join("").trim();
  return text === "" ? null : text;
}

export function isTeamAgent(labels: Record<string, string>, prefixes: string[]): boolean {
  return Object.keys(labels).some((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

// Paseo also flags every finished turn, which is not a call for help.
export function needsYou(agent: { requiresAttention?: boolean; attentionReason?: string | null }): boolean {
  return agent.requiresAttention === true && agent.attentionReason !== "finished";
}

async function listAgents(paseo: Paseo) {
  const agents = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ page: cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor } });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return agents.filter((agent) => !agent.archivedAt);
}

// An agent can be deleted between the list and its timeline read, as loop.py does at teardown.
export async function liveAgentsLabelled(paseo: Paseo, prefixes: string[]): Promise<{ agents: LiveAgent[]; problems: string[] }> {
  const agents = (await listAgents(paseo)).filter((agent) => isTeamAgent(agent.labels, prefixes));
  const read = await Promise.allSettled(agents.map(async (agent) => {
    const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: TIMELINE_TAIL, projection: "projected" });
    return {
      id: agent.id,
      title: agent.title,
      status: agent.status,
      model: agent.model ?? null,
      needsYou: needsYou(agent),
      labels: agent.labels,
      updatedAt: agent.updatedAt,
      lastSaid: lastSaid(page.entries.map((entry) => entry.item)),
    };
  }));
  return {
    agents: read.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    problems: read.flatMap((result, i) => (result.status === "rejected" ? [`agent ${agents[i].id}: ${String(result.reason)}`] : [])),
  };
}
