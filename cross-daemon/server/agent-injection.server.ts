import type { PluginBeforeRequests } from "@getpaseo/plugin/server";

// Paseo compiles plugins against the SDK only, so the config type comes from there, not @getpaseo/protocol.
type AgentSessionConfig = PluginBeforeRequests["agent.create"]["config"];

const TOOL_SERVER_NAME = "cross-daemon";
// Paseo refuses to create an agent with MCP servers or tool approvals on providers without them.
const PROVIDERS_WITH_MCP_TOOLS = new Set(["claude", "codex", "opencode"]);
// OpenCode turns off its auto-accept whenever a tool policy is present.
const PROVIDERS_TO_PREAPPROVE = new Set(["claude", "codex"]);

export function withCrossDaemonTools(
  config: AgentSessionConfig,
  launch: { command: string; proxyPath: string },
  toolNames: readonly string[],
): AgentSessionConfig {
  if (!PROVIDERS_WITH_MCP_TOOLS.has(config.provider)) return config;
  const withServer: AgentSessionConfig = {
    ...config,
    mcpServers: {
      ...config.mcpServers,
      [TOOL_SERVER_NAME]: {
        type: "stdio",
        command: launch.command,
        args: [launch.proxyPath],
        // Paseo's desktop daemon runs under Electron, whose binary runs a script only in Node mode.
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  };
  if (!PROVIDERS_TO_PREAPPROVE.has(config.provider)) return withServer;
  const preapproved = config.toolPolicy?.preapproved ?? [];
  const isGranted = (tool: string) => preapproved.some((grant) => grant.server === TOOL_SERVER_NAME && grant.tool === tool);
  const grants = toolNames.filter((tool) => !isGranted(tool)).map((tool) => ({ kind: "mcp" as const, server: TOOL_SERVER_NAME, tool }));
  return { ...withServer, toolPolicy: { ...config.toolPolicy, preapproved: [...preapproved, ...grants] } };
}
