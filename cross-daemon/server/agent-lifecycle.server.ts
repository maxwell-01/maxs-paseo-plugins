import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { inspectAgent } from "./agent-state.server";
import { CUT_OFF, describeError, MaybeDeliveredError } from "./messenger.server";
import type { PaseoCli } from "./paseo-cli.server";
import type { StartedAgents } from "./started-agents.server";
import type { WatchList } from "./watch-list.server";

const runResultSchema = z.object({ agentId: z.string(), status: z.string(), cwd: z.string() });
const workspaceSchema = z.object({ workspaceId: z.string(), cwd: z.string() });
const liveAgentSchema = z.object({ cwd: z.string() });

interface NewAgent {
  cwd: string;
  firstMessage: string;
  provider?: string;
  title?: string;
}

type StartOutcome = { kind: "started" | "first-prompt-not-started"; agentId: string; cwd: string };
export type WorkspaceCleanup =
  | { kind: "none" }
  | { kind: "archived" }
  | { kind: "in-use"; workspaceId: string; cwd: string }
  | { kind: "failed"; workspaceId: string; reason: string };
type ArchiveOutcome =
  | { kind: "archived"; agentId: string; workspace: WorkspaceCleanup }
  | { kind: "not-started-here" | "busy"; agentId: string };

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
        throw new MaybeDeliveredError(`The start timed out, so an agent may have started on ${peer.name}. Check list_agents before you try again; archive_agent cannot close it.`);
      }
      throw error;
    }
  }

  const runJson = async <Schema extends z.ZodType>(peer: Peer, args: readonly string[], schema: Schema) =>
    schema.parse(JSON.parse(await cli.run(peer.link, args)));

  async function workspaceFor(peer: Peer, agent: NewAgent) {
    const existing = (await runJson(peer, ["workspace", "ls", "--json"], z.array(workspaceSchema))).find(
      (workspace) => workspace.cwd === agent.cwd,
    );
    if (existing) return { workspaceId: existing.workspaceId, created: undefined };
    const args = ["workspace", "create", "--json", "--isolation=local", `--path=${agent.cwd}`];
    if (agent.title) args.push(`--title=${agent.title}`);
    const created = await runJson(peer, args, workspaceSchema);
    return { workspaceId: created.workspaceId, created };
  }

  async function archiveUnusedWorkspace(peer: Peer, workspaceId: string, startError: unknown) {
    try {
      await cli.run(peer.link, ["workspace", "archive", workspaceId, "--json"]);
    } catch (archiveError) {
      const reasons = `${describeError(startError, peer)}. Workspace ${workspaceId}, made for the agent, is left: ${describeError(archiveError, peer)}`;
      throw new Error(reasons);
    }
  }

  async function start(peer: Peer, agent: NewAgent, callerAgentId: string | null, notifyOnFinish: boolean): Promise<StartOutcome> {
    const { workspaceId, created } = await workspaceFor(peer, agent);
    // Options in --name=value form and the prompt after "--", so no value can be read as an option.
    // An explicit --workspace keeps the new agent out of any caller workspace the CLI would otherwise pick.
    const args = ["run", "--background", "--json", `--workspace=${workspaceId}`];
    if (agent.provider) args.push(`--provider=${agent.provider}`);
    if (agent.title) args.push(`--title=${agent.title}`);
    let output: string;
    try {
      output = await runStartCommand(peer, [...args, "--", agent.firstMessage]);
    } catch (error) {
      if (created && !(error instanceof MaybeDeliveredError)) await archiveUnusedWorkspace(peer, workspaceId, error);
      throw error;
    }
    const started = runResultSchema.parse(JSON.parse(output));
    const { agentId, cwd } = started;
    startedAgents.add({ peerServerId: peer.serverId, agentId, createdWorkspace: created });
    // paseo run returns once the first turn has started, and reports "running" only if it did.
    if (started.status !== "running") return { kind: "first-prompt-not-started", agentId, cwd };
    if (notifyOnFinish && callerAgentId) {
      watches.add({ peerServerId: peer.serverId, agentId, callerAgentId, updatedAtBeforeSend: null, sawBusy: true }, new Date());
    }
    return { kind: "started", agentId, cwd };
  }

  async function archive(peer: Peer, agentRef: string): Promise<ArchiveOutcome> {
    const agent = await inspectAgent(cli, peer, agentRef);
    const started = startedAgents.find({ peerServerId: peer.serverId, agentId: agent.id });
    if (!started) return { kind: "not-started-here", agentId: agent.id };
    if (agent.busy) return { kind: "busy", agentId: agent.id };
    await cli.run(peer.link, ["archive", agent.id, "--json"]);
    startedAgents.remove(started);
    const workspace = started.createdWorkspace ? await archiveCreatedWorkspace(peer, started.createdWorkspace) : { kind: "none" as const };
    return { kind: "archived", agentId: agent.id, workspace };
  }

  // Archiving a workspace archives every agent in it, so one that another agent may use is kept.
  async function archiveCreatedWorkspace(peer: Peer, { workspaceId, cwd }: z.output<typeof workspaceSchema>): Promise<WorkspaceCleanup> {
    try {
      const liveAgents = await runJson(peer, ["ls", "--global", "--json"], z.array(liveAgentSchema));
      if (liveAgents.some((live) => live.cwd === cwd)) return { kind: "in-use", workspaceId, cwd };
      await cli.run(peer.link, ["workspace", "archive", workspaceId, "--json"]);
      return { kind: "archived" };
    } catch (error) {
      return { kind: "failed", workspaceId, reason: describeError(error, peer) };
    }
  }

  return { start, archive };
}
export type AgentLifecycle = ReturnType<typeof createAgentLifecycle>;
