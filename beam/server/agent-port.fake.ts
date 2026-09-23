import type { AgentNoticePort } from "./beam-agent-notice.server";

type FakeAgent = { id: string; workspaceId?: string; status: "idle" | "running" };

export function createFakeAgentPort(agents: FakeAgent[], options: { pageSize?: number; failSend?: boolean } = {}) {
  const sent: Array<{ agentId: string; text: string }> = [];
  const pageSize = options.pageSize ?? agents.length;
  const port = {
    agents: {
      list: async (request: { page: { limit: number; cursor?: string } }) => {
        const start = Number(request.page.cursor ?? 0);
        const end = start + Math.min(request.page.limit, pageSize);
        const hasMore = end < agents.length;
        return {
          entries: agents.slice(start, end).map((agent) => ({ agent })),
          pageInfo: { nextCursor: hasMore ? String(end) : null, hasMore },
        };
      },
      ref: (agentId: string) => ({
        send: async (text: string) => {
          if (options.failSend) {
            throw new Error("daemon unreachable");
          }
          sent.push({ agentId, text });
        },
      }),
    },
  } satisfies AgentNoticePort;
  return { port, sent };
}
