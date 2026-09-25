import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import type { PaseoCli } from "./paseo-cli.server";

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

export function createTools(deps: { readPeers(): Peer[]; cli: PaseoCli }): Tools {
  const onPeer = async (ref: string, args: readonly string[]): Promise<ToolResult> => {
    const peer = findPeer(deps.readPeers(), ref);
    if (typeof peer === "string") return { text: peer, isError: true };
    try {
      return { text: await deps.cli.run(peer.link, args) };
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replaceAll(peer.link, `<link to ${peer.name}>`);
      const prefix = UNREACHABLE.test(reason) ? `Could not reach ${peer.name}` : `paseo on ${peer.name} failed`;
      return { text: `${prefix}: ${reason}`, isError: true };
    }
  };

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
