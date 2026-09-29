import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { inspectAgent } from "./messenger.server";
import type { PaseoCli } from "./paseo-cli.server";
import type { StartedAgents } from "./started-agents.server";
import type { WatchList } from "./watch-list.server";

const runResultSchema = z.object({ agentId: z.string(), cwd: z.string() });

// A new agent has had no turn before its first prompt, so any UpdatedAt it reports means one ran.
const NO_TURN_YET = "";

export interface NewAgent {
  cwd: string;
  firstMessage: string;
  provider?: string;
  title?: string;
}

export type ArchiveOutcome = { kind: "archived" | "not-started-here" | "busy"; agentId: string };

interface AgentLifecycleDependencies {
  cli: PaseoCli;
  watches: WatchList;
  startedAgents: StartedAgents;
  now?: () => number;
}

export function createAgentLifecycle({ cli, watches, startedAgents, now = Date.now }: AgentLifecycleDependencies) {
  async function start(peer: Peer, agent: NewAgent, callerAgentId: string | null, notifyOnFinish: boolean) {
    // Options in --name=value form and the prompt after "--", so no value can be read as an option.
    // --new-workspace keeps the new agent out of any caller workspace the CLI would otherwise pick.
    const args = ["run", "--background", "--json", "--new-workspace=local", `--cwd=${agent.cwd}`];
    if (agent.provider) args.push(`--provider=${agent.provider}`);
    if (agent.title) args.push(`--title=${agent.title}`);
    const started = runResultSchema.parse(JSON.parse(await cli.run(peer.link, [...args, "--", agent.firstMessage])));
    startedAgents.add({ peerServerId: peer.serverId, agentId: started.agentId });
    if (notifyOnFinish && callerAgentId) {
      watches.add({ peerServerId: peer.serverId, agentId: started.agentId, callerAgentId, updatedAtBeforeSend: NO_TURN_YET }, new Date(now()));
    }
    return started;
  }

  async function archive(peer: Peer, agentRef: string): Promise<ArchiveOutcome> {
    const agent = await inspectAgent(cli, peer, agentRef);
    const started = { peerServerId: peer.serverId, agentId: agent.id };
    if (!startedAgents.has(started)) return { kind: "not-started-here", agentId: agent.id };
    if (agent.busy) return { kind: "busy", agentId: agent.id };
    await cli.run(peer.link, ["archive", agent.id, "--json"]);
    startedAgents.remove(started);
    return { kind: "archived", agentId: agent.id };
  }

  return { start, archive };
}
export type AgentLifecycle = ReturnType<typeof createAgentLifecycle>;
