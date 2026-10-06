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

export async function liveAgentsLabelled(paseo: Paseo, prefixes: string[]): Promise<LiveAgent[]> {
  const agents = (await listAgents(paseo))
    .filter((agent) => Object.keys(agent.labels).some((key) => prefixes.some((prefix) => key.startsWith(prefix))));
  return Promise.all(agents.map(async (agent) => {
    const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: TIMELINE_TAIL, projection: "projected" });
    return {
      id: agent.id,
      title: agent.title,
      status: agent.status,
      model: agent.model ?? null,
      needsYou: agent.requiresAttention === true && agent.attentionReason !== "finished",
      labels: agent.labels,
      updatedAt: agent.updatedAt,
      lastSaid: lastSaid(page.entries.map((entry) => entry.item)),
    };
  }));
}
