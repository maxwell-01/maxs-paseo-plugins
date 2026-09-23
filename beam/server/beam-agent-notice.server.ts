const AGENT_LIST_PAGE_SIZE = 100;

export interface AgentNoticePort {
  agents: {
    list(options: { page: { limit: number; cursor?: string } }): Promise<{
      entries: Array<{ agent: { id: string; workspaceId?: string; status: string } }>;
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    }>;
    ref(agentId: string): { send(text: string): Promise<unknown> };
  };
}

export interface BeamTarget {
  workspaceId: string;
  mainPath: string;
}

function buildBeamingNotice(mainPath: string): string {
  return `Beam: this workspace is now mirrored live onto the main checkout at ${mainPath}. Your changes here appear there automatically. Do not edit files or run git commands in ${mainPath}. Reply "OK" and nothing else.`;
}

function buildStoppedNotice(mainPath: string): string {
  return `Beam: this workspace is no longer mirrored onto ${mainPath}, and that checkout is back on its own branch. Reply "OK" and nothing else.`;
}

export function createAgentNotices() {
  const toldMainPathByAgent = new Map<string, string>();

  async function notifyAgent(
    port: AgentNoticePort,
    agentId: string,
    agentWorkspaceId: string | null | undefined,
    beam: BeamTarget | null,
  ): Promise<void> {
    const beamingMainPath = beam && beam.workspaceId === agentWorkspaceId ? beam.mainPath : null;
    const toldMainPath = toldMainPathByAgent.get(agentId) ?? null;
    if (beamingMainPath === toldMainPath) {
      return;
    }
    if (beamingMainPath) {
      await port.agents.ref(agentId).send(buildBeamingNotice(beamingMainPath));
      toldMainPathByAgent.set(agentId, beamingMainPath);
    } else if (toldMainPath) {
      await port.agents.ref(agentId).send(buildStoppedNotice(toldMainPath));
      toldMainPathByAgent.delete(agentId);
    }
  }

  async function notifyIdleAgents(
    port: AgentNoticePort,
    workspaceId: string,
    beam: BeamTarget | null,
  ): Promise<void> {
    let cursor: string | undefined;
    do {
      const { entries, pageInfo } = await port.agents.list({
        page: { limit: AGENT_LIST_PAGE_SIZE, cursor },
      });
      for (const { agent } of entries) {
        if (agent.workspaceId === workspaceId && agent.status === "idle") {
          await notifyAgent(port, agent.id, agent.workspaceId, beam);
        }
      }
      cursor = pageInfo.hasMore ? (pageInfo.nextCursor ?? undefined) : undefined;
    } while (cursor);
  }

  return { notifyAgent, notifyIdleAgents };
}

export type AgentNotices = ReturnType<typeof createAgentNotices>;
