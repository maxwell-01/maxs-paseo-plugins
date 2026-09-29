import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { inspectAgent } from "./agent-state.server";
import { CUT_OFF, describeError, MaybeDeliveredError } from "./messenger.server";
import type { PaseoCli } from "./paseo-cli.server";
import type { StartedAgents } from "./started-agents.server";
import type { WatchList } from "./watch-list.server";

const runResultSchema = z.object({ agentId: z.string(), status: z.string(), cwd: z.string() });

interface NewAgent {
  cwd: string;
  firstMessage: string;
  provider?: string;
  title?: string;
}

type StartOutcome = { kind: "started" | "first-prompt-not-started"; agentId: string; cwd: string };
type ArchiveOutcome = { kind: "archived" | "not-started-here" | "busy"; agentId: string };

interface AgentLifecycleDependencies {
  cli: PaseoCli;
  watches: WatchList;
  startedAgents: StartedAgents;
}

export function createAgentLifecycle({ cli, watches, startedAgents }: AgentLifecycleDependencies) {
  async function runStartCommand(peer: Peer, args: readonly string[]) {
    try {
      return await cli.run(peer.link, args);
    } catch (error) {
      if (CUT_OFF.test(describeError(error, peer))) {
        throw new MaybeDeliveredError(`The start timed out, so an agent may have started on ${peer.name}. Check list_agents before you try again.`);
      }
      throw error;
    }
  }

  async function start(peer: Peer, agent: NewAgent, callerAgentId: string | null, notifyOnFinish: boolean): Promise<StartOutcome> {
    // Options in --name=value form and the prompt after "--", so no value can be read as an option.
    // --new-workspace keeps the new agent out of any caller workspace the CLI would otherwise pick.
    const args = ["run", "--background", "--json", "--new-workspace=local", `--cwd=${agent.cwd}`];
    if (agent.provider) args.push(`--provider=${agent.provider}`);
    if (agent.title) args.push(`--title=${agent.title}`);
    const started = runResultSchema.parse(JSON.parse(await runStartCommand(peer, [...args, "--", agent.firstMessage])));
    const { agentId, cwd } = started;
    startedAgents.add({ peerServerId: peer.serverId, agentId });
    // paseo run returns once the first turn has started, and reports "running" only if it did.
    if (started.status !== "running") return { kind: "first-prompt-not-started", agentId, cwd };
    if (notifyOnFinish && callerAgentId) {
      watches.add({ peerServerId: peer.serverId, agentId, callerAgentId, updatedAtBeforeSend: null, sawBusy: true }, new Date());
    }
    return { kind: "started", agentId, cwd };
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
