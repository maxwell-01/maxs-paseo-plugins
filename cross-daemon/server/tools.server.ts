import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { isAgentBusy, sendPrompt } from "./message-delivery.server";
import type { MessageQueue } from "./message-queue.server";
import type { PaseoCli } from "./paseo-cli.server";

export interface DaemonIdentity {
  name: string;
  serverId: string | null;
}

interface ToolDependencies {
  readPeers(): Peer[];
  cli: PaseoCli;
  queue: MessageQueue;
  ownDaemon(): Promise<DaemonIdentity>;
}

export interface ToolCaller {
  callerAgentId: string | null;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface Tool extends ToolDefinition {
  call(args: unknown, caller: ToolCaller): Promise<ToolResult>;
}

export interface Tools {
  definitions: ToolDefinition[];
  call(name: string, args: unknown, caller: ToolCaller): Promise<ToolResult>;
}

function defineTool<Schema extends z.ZodType>(spec: {
  name: string;
  description: string;
  input: Schema;
  run(input: z.output<Schema>, caller: ToolCaller): Promise<ToolResult> | ToolResult;
}): Tool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input),
    async call(args, caller) {
      const parsed = spec.input.safeParse(args);
      if (!parsed.success) return { text: `Invalid input for ${spec.name}: ${z.prettifyError(parsed.error)}`, isError: true };
      return spec.run(parsed.data, caller);
    },
  };
}

const NO_PEERS =
  "No other daemon is reachable. In the Paseo app, turn on Allow cross-daemon comms in the Cross-daemon " +
  "settings of this daemon and at least one other, then keep the app open until they sync.";

const DEFAULT_ACTIVITY_ENTRIES = 30;
const UNREACHABLE = /cannot connect|timed out|unreachable|ECONNREFUSED/i;

const daemonInput = z.string().min(1).describe("The daemon's name or server ID, from list_daemons.");
const agentIdInput = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an agent ID or its prefix")
  .describe("The agent's ID or ID prefix, from list_agents.");

function findPeer(peers: readonly Peer[], ref: string): Peer | string {
  const byServerId = peers.find((peer) => peer.serverId === ref);
  if (byServerId) return byServerId;
  const byName = peers.filter((peer) => peer.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    return `Two or more daemons are named "${ref}". Use a server ID: ${byName.map((peer) => peer.serverId).join(", ")}.`;
  }
  const reachable = peers.map((peer) => `${peer.name} (${peer.serverId})`).join(", ") || "none";
  return `No reachable daemon has the name or ID "${ref}". Reachable: ${reachable}.`;
}

function composeMessage(own: DaemonIdentity, callerAgentId: string | null, prompt: string): string {
  const sender = callerAgentId ? `agent ${callerAgentId}` : "a user or script";
  const origin = own.serverId ? `"${own.name}" (${own.serverId})` : `"${own.name}"`;
  const lines = [`[cross-daemon message from ${sender} on daemon ${origin}]`, "", prompt];
  if (callerAgentId && own.serverId) {
    lines.push("", `To reply, call the cross-daemon send_agent_prompt tool with daemon "${own.serverId}" and agentId "${callerAgentId}".`);
  }
  return lines.join("\n");
}

export function createTools(deps: ToolDependencies): Tools {
  const reachPeer = async (ref: string, action: (peer: Peer) => Promise<ToolResult>): Promise<ToolResult> => {
    const peer = findPeer(deps.readPeers(), ref);
    if (typeof peer === "string") return { text: peer, isError: true };
    try {
      return await action(peer);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replaceAll(peer.link, `<link to ${peer.name}>`);
      const prefix = UNREACHABLE.test(reason) ? `Could not reach ${peer.name}` : `paseo on ${peer.name} failed`;
      return { text: `${prefix}: ${reason}`, isError: true };
    }
  };
  const onPeer = (ref: string, args: readonly string[]) =>
    reachPeer(ref, async (peer) => ({ text: await deps.cli.run(peer.link, args) }));

  const tools = [
    defineTool({
      name: "list_daemons",
      description: "List the other Paseo daemons whose agents you can reach with the cross-daemon tools.",
      input: z.object({}),
      run() {
        const daemons = deps.readPeers().map(({ name, serverId }) => ({ name, serverId }));
        if (daemons.length === 0) return { text: NO_PEERS };
        return { text: JSON.stringify({ daemons }) };
      },
    }),
    defineTool({
      name: "list_workspaces",
      description: "List the workspaces on another Paseo daemon.",
      input: z.object({ daemon: daemonInput }),
      run: ({ daemon }) => onPeer(daemon, ["workspace", "ls", "--json"]),
    }),
    defineTool({
      name: "list_agents",
      description: "List the agents on another Paseo daemon, with their status and folder.",
      input: z.object({ daemon: daemonInput }),
      run: ({ daemon }) => onPeer(daemon, ["ls", "--global", "--json"]),
    }),
    defineTool({
      name: "get_agent_activity",
      description: "Read the recent activity of an agent on another Paseo daemon.",
      input: z.object({
        daemon: daemonInput,
        agentId: agentIdInput,
        tail: z.number().int().min(1).max(500).default(DEFAULT_ACTIVITY_ENTRIES).describe("How many recent entries to read."),
      }),
      run: ({ daemon, agentId, tail }) => onPeer(daemon, ["logs", agentId, "--tail", String(tail)]),
    }),
    defineTool({
      name: "send_agent_prompt",
      description:
        "Send a message to an agent on another Paseo daemon. If the agent is working, the message is queued " +
        "and delivered when it is idle, so its work is not interrupted.",
      input: z.object({ daemon: daemonInput, agentId: agentIdInput, prompt: z.string().min(1) }),
      run: async ({ daemon, agentId, prompt }, { callerAgentId }) => {
        const text = composeMessage(await deps.ownDaemon(), callerAgentId, prompt);
        return reachPeer(daemon, async (peer) => {
          if (deps.queue.hasPendingFor(peer.serverId, agentId)) {
            deps.queue.add({ peerServerId: peer.serverId, agentId, text, callerAgentId });
            return { text: `Agent ${agentId} on ${peer.name} has earlier messages waiting. Yours is queued behind them.` };
          }
          if (await isAgentBusy(deps.cli, peer.link, agentId)) {
            deps.queue.add({ peerServerId: peer.serverId, agentId, text, callerAgentId });
            return { text: `Agent ${agentId} on ${peer.name} is working. Your message is queued and will be delivered when it is idle.` };
          }
          await sendPrompt(deps.cli, peer.link, agentId, text);
          return { text: `Sent to agent ${agentId} on ${peer.name}.` };
        });
      },
    }),
  ];
  return {
    definitions: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async call(name, args, caller) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return { text: `Unknown cross-daemon tool: ${name}`, isError: true };
      return tool.call(args, caller);
    },
  };
}
