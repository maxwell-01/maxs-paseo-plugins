import type { AgentNotices, AgentNoticePort } from "./beam-agent-notice.server";
import {
  applyBeamingTitle,
  readWorkspaceTitle,
  restoreWorkspaceTitle,
  type WorkspaceTitlePort,
} from "./beam-title.server";
import { activate, deactivate, logBeam, status } from "./beam.server";

type BeamPort = WorkspaceTitlePort & AgentNoticePort;

function logSideEffectFailure(action: string, error: unknown): void {
  logBeam("warn", `${action}: ${error instanceof Error ? error.message : String(error)}`);
}

export async function beamIn(
  port: BeamPort,
  notices: AgentNotices,
  input: { workspaceId: string; workspaceName: string; workspaceDir: string },
): Promise<{ active: true; mainPath: string }> {
  const titleMark = await readWorkspaceTitle(port, input.workspaceId).catch((error: unknown) => {
    logSideEffectFailure("could not read the workspace title", error);
    return undefined;
  });
  const result = await activate({ ...input, titleMark });
  if (titleMark) {
    await applyBeamingTitle(port, input.workspaceId, titleMark).catch((error: unknown) =>
      logSideEffectFailure("could not mark the workspace as beaming", error),
    );
  }
  await notices
    .notifyIdleAgents(port, input.workspaceId, { workspaceId: input.workspaceId, mainPath: result.mainPath })
    .catch((error: unknown) =>
      logSideEffectFailure("could not tell the workspace's agents about the beam", error),
    );
  return result;
}

export async function beamOut(port: BeamPort, notices: AgentNotices): Promise<{ active: false }> {
  const { workspaceId, titleMark } = await deactivate();
  if (workspaceId) {
    await restoreWorkspaceTitle(port, workspaceId, titleMark).catch((error: unknown) =>
      logSideEffectFailure(
        `could not restore the workspace title to ${titleMark?.originalTitle ?? "none"}`,
        error,
      ),
    );
    await notices
      .notifyIdleAgents(port, workspaceId, null)
      .catch((error: unknown) =>
        logSideEffectFailure("could not tell the workspace's agents the beam stopped", error),
      );
  }
  return { active: false };
}

export async function notifyAgentAfterTurn(
  port: AgentNoticePort,
  notices: AgentNotices,
  agent: { id: string; workspaceId: string | null },
): Promise<void> {
  const beam = await status();
  const target = beam.active && beam.workspaceId ? { workspaceId: beam.workspaceId, mainPath: beam.mainPath } : null;
  await notices
    .notifyAgent(port, agent.id, agent.workspaceId, target)
    .catch((error: unknown) => logSideEffectFailure(`could not tell agent ${agent.id} about the beam`, error));
}
