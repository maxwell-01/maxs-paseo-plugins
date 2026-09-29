import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

export const workspaceSchema = z.object({ workspaceId: z.string(), cwd: z.string() });
export type Workspace = z.infer<typeof workspaceSchema>;
const startedAgentSchema = z.object({
  peerServerId: z.string(),
  agentId: z.string(),
  createdWorkspace: workspaceSchema.optional(),
});
type StartedAgent = z.infer<typeof startedAgentSchema>;
type AgentKey = Pick<StartedAgent, "peerServerId" | "agentId">;

export function createStartedAgents(stateDir: string) {
  const startedFile = join(stateDir, "started-agents.json");
  const list = (): StartedAgent[] => readPrivateJson(startedFile, z.array(startedAgentSchema), []);
  const isSame = (a: AgentKey, b: AgentKey) => a.peerServerId === b.peerServerId && a.agentId === b.agentId;
  return {
    add(agent: StartedAgent): void {
      writePrivateJson(startedFile, [...list(), agent]);
    },
    find(agent: AgentKey): StartedAgent | undefined {
      return list().find((started) => isSame(started, agent));
    },
    findCreatedWorkspace(peerServerId: string, workspaceId: string): Workspace | undefined {
      return list().find((started) => started.peerServerId === peerServerId && started.createdWorkspace?.workspaceId === workspaceId)
        ?.createdWorkspace;
    },
    remove(agent: AgentKey): void {
      writePrivateJson(startedFile, list().filter((started) => !isSame(started, agent)));
    },
  };
}
export type StartedAgents = ReturnType<typeof createStartedAgents>;
