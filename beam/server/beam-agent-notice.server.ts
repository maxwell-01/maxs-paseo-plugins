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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentNotices() {
  const toldMainPathByAgent = new Map<string, string>();

  function recordTold(agentId: string, mainPath: string | null): void {
    if (mainPath) {
      toldMainPathByAgent.set(agentId, mainPath);
    } else {
      toldMainPathByAgent.delete(agentId);
    }
  }

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
    const notice = beamingMainPath
      ? buildBeamingNotice(beamingMainPath)
      : toldMainPath && buildStoppedNotice(toldMainPath);
    if (!notice) {
      return;
    }
    recordTold(agentId, beamingMainPath);
    try {
      await port.agents.ref(agentId).send(notice);
    } catch (error) {
      recordTold(agentId, toldMainPath);
      throw error;
    }
  }

  async function notifyIdleAgents(
    port: AgentNoticePort,
    workspaceId: string,
    beam: BeamTarget | null,
  ): Promise<void> {
    const failures: string[] = [];
    let cursor: string | undefined;
    do {
      const { entries, pageInfo } = await port.agents.list({
        page: { limit: AGENT_LIST_PAGE_SIZE, cursor },
      });
      for (const { agent } of entries) {
        if (agent.workspaceId === workspaceId && agent.status === "idle") {
          await notifyAgent(port, agent.id, agent.workspaceId, beam).catch((error: unknown) => {
            failures.push(`could not tell agent ${agent.id}: ${describeError(error)}`);
          });
        }
      }
      cursor = pageInfo.hasMore ? (pageInfo.nextCursor ?? undefined) : undefined;
    } while (cursor);
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
  }

  return { notifyAgent, notifyIdleAgents };
}

export type AgentNotices = ReturnType<typeof createAgentNotices>;
