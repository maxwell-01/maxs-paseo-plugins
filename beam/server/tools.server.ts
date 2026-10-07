import { z } from "zod";

export interface ToolCaller {
  callerAgentId: string | null;
  signal: AbortSignal;
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

export function defineTool<Schema extends z.ZodType>(spec: {
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
