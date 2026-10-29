import { beamIn as beamWorkspaceIn, beamOut as beamWorkspaceOut } from "./beam-rpc.server";
import type { WorkspaceTitleHandle } from "./beam-title.server";
import { type BeamHolder, BeamHeldError, readHolder } from "./beam.server";
import { releaseStaleHolder } from "./stale-holder.server";
import { createWaitingAgents, type WaitingAgent } from "./waiting-agents.server";

export const MAX_WAIT_SECONDS = 300;

export interface AgentBeamPort {
  agents: {
    ref(agentId: string): {
      refresh(): Promise<{ agent: { workspaceId?: string | null; title: string | null } } | null>;
    };
  };
  workspaces: {
    ref(workspaceId: string): Omit<WorkspaceTitleHandle, "refresh"> & {
      refresh(): Promise<{
        name: string;
        workspaceDirectory: string;
        archivingAt: string | null;
      } | null>;
    };
  };
}

interface CallerWorkspace {
  workspaceId: string;
  workspaceName: string;
  workspaceDir: string;
  agentTitle: string | null;
}

export type BeamInResult =
  | { result: "beamed-in"; waiting: WaitingAgent[] }
  | { result: "already-yours"; waiting: WaitingAgent[] }
  | { result: "held"; holder: BeamHolder | null; waiting: WaitingAgent[]; waitedSeconds: number }
  | { result: "aborted" };

export type BeamOutResult =
  | { result: "beamed-out"; waiting: WaitingAgent[] }
  | { result: "not-yours"; holder: BeamHolder }
  | { result: "no-beam" };

export async function resolveCallerWorkspace(
  port: AgentBeamPort,
  agentId: string,
): Promise<CallerWorkspace> {
  const found = await port.agents.ref(agentId).refresh();
  if (!found) {
    throw new Error(`agent ${agentId} not found`);
  }
  const { workspaceId, title } = found.agent;
  if (!workspaceId) {
    throw new Error(`agent ${agentId} has no workspace`);
  }
  const workspace = await port.workspaces.ref(workspaceId).refresh();
  if (!workspace) {
    throw new Error(`workspace ${workspaceId} is not listed`);
  }
  if (!workspace.workspaceDirectory) {
    throw new Error(`workspace ${workspaceId} has no directory`);
  }
  return {
    workspaceId,
    workspaceName: workspace.name,
    workspaceDir: workspace.workspaceDirectory,
    agentTitle: title,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export function createAgentBeam({ pollMs }: { pollMs: number }) {
  const waitingAgents = createWaitingAgents();

  async function status(port: AgentBeamPort, agentId: string | null) {
    await releaseStaleHolder(port);
    const holder = readHolder();
    if (!holder) {
      return { active: false, callerHolds: false, waiting: [] };
    }
    const callerWorkspaceId = agentId ? (await port.agents.ref(agentId).refresh())?.agent.workspaceId : null;
    return { active: true, holder, callerHolds: holder.workspaceId === callerWorkspaceId, waiting: waitingAgents.list() };
  }

  async function beamIn(
    port: AgentBeamPort,
    agentId: string,
    options: { waitSeconds?: number; signal: AbortSignal },
  ): Promise<BeamInResult> {
    const caller = await resolveCallerWorkspace(port, agentId);
    const startedAt = Date.now();
    const deadline = startedAt + Math.min(options.waitSeconds ?? MAX_WAIT_SECONDS, MAX_WAIT_SECONDS) * 1000;

    for (;;) {
      await releaseStaleHolder(port);
      if (options.signal.aborted) {
        waitingAgents.left(agentId);
        return { result: "aborted" };
      }
      if (readHolder()?.workspaceId === caller.workspaceId) {
        waitingAgents.left(agentId);
        return { result: "already-yours", waiting: waitingAgents.list() };
      }
      try {
        const { agentTitle, ...workspace } = caller;
        await beamWorkspaceIn(port, { ...workspace, agent: { agentId, agentTitle } }, options.signal);
        waitingAgents.left(agentId);
        return { result: "beamed-in", waiting: waitingAgents.list() };
      } catch (error) {
        if (options.signal.aborted) {
          waitingAgents.left(agentId);
          return { result: "aborted" };
        }
        if (!(error instanceof BeamHeldError)) {
          throw error;
        }
        waitingAgents.asked({ agentId, agentTitle: caller.agentTitle, workspaceName: caller.workspaceName });
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          return {
            result: "held",
            holder: error.holder,
            waiting: waitingAgents.list(),
            waitedSeconds: (Date.now() - startedAt) / 1000,
          };
        }
        await sleep(Math.min(pollMs, remainingMs), options.signal);
      }
    }
  }

  async function beamOut(port: AgentBeamPort, agentId: string): Promise<BeamOutResult> {
    const caller = await resolveCallerWorkspace(port, agentId);
    await releaseStaleHolder(port);
    const holder = readHolder();
    if (!holder) {
      return { result: "no-beam" };
    }
    if (holder.workspaceId !== caller.workspaceId) {
      return { result: "not-yours", holder };
    }
    await beamWorkspaceOut(port);
    return { result: "beamed-out", waiting: waitingAgents.list() };
  }

  return { status, beamIn, beamOut };
}
