import type { AgentNoticePort, AgentNotices } from "./beam-agent-notice.server";
import { logBeamWarning, status } from "./beam.server";

export async function notifyAgentAfterTurn(
  port: AgentNoticePort,
  notices: AgentNotices,
  agent: { id: string; workspaceId: string | null },
  outcome: { kind: "completed" | "failed" | "canceled" },
): Promise<void> {
  if (outcome.kind === "canceled") {
    return;
  }
  try {
    const beam = await status();
    const target =
      beam.active && beam.workspaceId ? { workspaceId: beam.workspaceId, mainPath: beam.mainPath } : null;
    await notices.notifyAgent(port, agent.id, agent.workspaceId, target);
  } catch (error) {
    logBeamWarning(`could not tell agent ${agent.id} about the beam`, error);
  }
}
