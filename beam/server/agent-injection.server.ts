import { randomUUID } from "node:crypto";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { AGENT_TOKEN_ENV } from "./agent-tokens.server";

type AgentCreateRequest = PluginBeforeRequests["agent.create"];
// Paseo compiles plugins against the SDK only, so the config type comes from there, not @getpaseo/protocol.
type AgentSessionConfig = AgentCreateRequest["config"];

const TOOL_SERVER_NAME = "beam";
// Paseo refuses to create an agent with MCP servers or tool approvals on providers without them.
const PROVIDERS_WITH_MCP_TOOLS = new Set(["claude", "codex", "opencode"]);
// OpenCode turns off its auto-accept whenever a tool policy is present.
const PROVIDERS_TO_PREAPPROVE = new Set(["claude", "codex"]);
const PROVIDERS_HIDING_AGENT_ID_FROM_MCP = new Set(["codex"]);

export function withBeamTools(
  request: AgentCreateRequest,
  launch: { command: string; proxyPath: string },
  toolNames: readonly string[],
): AgentCreateRequest {
  const { config } = request;
  if (!PROVIDERS_WITH_MCP_TOOLS.has(config.provider)) return request;
  const tokenEnv = PROVIDERS_HIDING_AGENT_ID_FROM_MCP.has(config.provider) ? { [AGENT_TOKEN_ENV]: randomUUID() } : null;
  const withServer: AgentSessionConfig = {
    ...config,
    mcpServers: {
      ...config.mcpServers,
      [TOOL_SERVER_NAME]: {
        type: "stdio",
        command: launch.command,
        args: [launch.proxyPath],
        // Paseo's desktop daemon runs under Electron, whose binary runs a script only in Node mode.
        env: { ELECTRON_RUN_AS_NODE: "1", ...tokenEnv },
      },
    },
  };
  const withTools = PROVIDERS_TO_PREAPPROVE.has(config.provider) ? withPreapprovedTools(withServer, toolNames) : withServer;
  return tokenEnv ? { config: withTools, env: { ...request.env, ...tokenEnv } } : { ...request, config: withTools };
}

function withPreapprovedTools(config: AgentSessionConfig, toolNames: readonly string[]): AgentSessionConfig {
  const preapproved = config.toolPolicy?.preapproved ?? [];
  const isGranted = (tool: string) => preapproved.some((grant) => grant.server === TOOL_SERVER_NAME && grant.tool === tool);
  const grants = toolNames.filter((tool) => !isGranted(tool)).map((tool) => ({ kind: "mcp" as const, server: TOOL_SERVER_NAME, tool }));
  return { ...config, toolPolicy: { ...config.toolPolicy, preapproved: [...preapproved, ...grants] } };
}
