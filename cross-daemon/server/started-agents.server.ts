import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

const startedAgentSchema = z.object({ peerServerId: z.string(), agentId: z.string() });
type StartedAgent = z.infer<typeof startedAgentSchema>;

// Agents on other daemons that create_agent started: the only ones archive_agent may close.
export function createStartedAgents(stateDir: string) {
  const startedFile = join(stateDir, "started-agents.json");
  const list = (): StartedAgent[] => readPrivateJson(startedFile, z.array(startedAgentSchema), []);
  const isSame = (a: StartedAgent, b: StartedAgent) => a.peerServerId === b.peerServerId && a.agentId === b.agentId;
  return {
    add(agent: StartedAgent): void {
      writePrivateJson(startedFile, [...list(), agent]);
    },
    has(agent: StartedAgent): boolean {
      return list().some((started) => isSame(started, agent));
    },
    remove(agent: StartedAgent): void {
      writePrivateJson(startedFile, list().filter((started) => !isSame(started, agent)));
    },
  };
}
export type StartedAgents = ReturnType<typeof createStartedAgents>;
