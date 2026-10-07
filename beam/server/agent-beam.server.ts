import { beamIn as beamWorkspaceIn, beamOut as beamWorkspaceOut } from "./beam-rpc.server";
import type { WorkspaceTitleHandle } from "./beam-title.server";
import { type BeamHolder, BeamHeldError, readHolder } from "./beam.server";
import { releaseStaleHolder } from "./stale-holder.server";

export const MAX_WAIT_SECONDS = 300;

export interface AgentBeamPort {
  agents: {
    ref(agentId: string): {
      refresh(): Promise<{ agent: { workspaceId?: string | null } } | null>;
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
}

export type BeamInResult =
  | { result: "beamed-in" }
  | { result: "already-yours" }
  | { result: "held"; holder: BeamHolder | null; waitedSeconds: number }
  | { result: "aborted" };

export type BeamOutResult =
  | { result: "beamed-out" }
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
  const { workspaceId } = found.agent;
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
  async function status(port: AgentBeamPort, agentId: string | null) {
    await releaseStaleHolder(port);
    const holder = readHolder();
    if (!holder) {
      return { active: false, callerHolds: false };
    }
    const callerWorkspaceId = agentId ? (await port.agents.ref(agentId).refresh())?.agent.workspaceId : null;
    return { active: true, holder, callerHolds: holder.workspaceId === callerWorkspaceId };
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
        return { result: "aborted" };
      }
      if (readHolder()?.workspaceId === caller.workspaceId) {
        return { result: "already-yours" };
      }
      try {
        await beamWorkspaceIn(port, caller);
        return { result: "beamed-in" };
      } catch (error) {
        if (!(error instanceof BeamHeldError)) {
          throw error;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          return {
            result: "held",
            holder: error.holder,
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
    return { result: "beamed-out" };
  }

  return { status, beamIn, beamOut };
}
