import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";

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

export function createTools(deps: { readPeers(): Peer[] }): Tools {
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
