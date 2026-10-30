import { join } from "node:path";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { AGENT_ID_ENV, installToolProxy } from "./tool-proxy.server";
import { serveTools, type Tools } from "./tool-socket.server";
import { MAX_WAIT_SECONDS } from "./tools.server";

type SessionOpening = PluginBeforeRequests["agent.session_open"];
type AgentCreateRequest = PluginBeforeRequests["agent.create"];

const TOOL_SERVER_NAME = "shared-stack";
const PROXY_TIMEOUT_MARGIN_SECONDS = 30;
// Paseo refuses MCP servers and tool approvals on providers without them.
const PROVIDERS_WITH_MCP_TOOLS = new Set(["claude", "codex", "opencode"]);
// OpenCode turns off its auto-accept whenever a tool policy is present.
const PROVIDERS_TO_PREAPPROVE = new Set(["claude", "codex"]);

// Plugin agent tools in Paseo 0.14 only reach agents when the daemon injects its own Paseo tools,
// which is off by default. So, like Beam, the plugin serves its tools as a small MCP server.
export async function startAgentTools(dataDir: string, tools: Tools) {
  const socketPath = join(dataDir, "tools.sock");
  const proxyPath = installToolProxy(dataDir, { socketPath, tools: tools.definitions, pluginTimeoutMs: (MAX_WAIT_SECONDS + PROXY_TIMEOUT_MARGIN_SECONDS) * 1000 });
  const stop = await serveTools(socketPath, tools);
  const toolNames = tools.definitions.map((tool) => tool.name);

  // Launch-only, so agents that existed before the plugin get the tools when their session next opens.
  function withToolServer(request: SessionOpening): SessionOpening {
    if (request.purpose === "history" || !PROVIDERS_WITH_MCP_TOOLS.has(request.provider)) return request;
    return {
      ...request,
      mcpServers: {
        ...request.mcpServers,
        [TOOL_SERVER_NAME]: {
          type: "stdio",
          command: process.execPath,
          args: [proxyPath],
          // Paseo's desktop daemon runs under Electron, whose binary runs a script only in Node mode.
          env: { ELECTRON_RUN_AS_NODE: "1", [AGENT_ID_ENV]: request.agentId },
        },
      },
    };
  }

  function withPreapprovedTools(request: AgentCreateRequest): AgentCreateRequest {
    const { config } = request;
    if (!PROVIDERS_TO_PREAPPROVE.has(config.provider)) return request;
    const preapproved = config.toolPolicy?.preapproved ?? [];
    const granted = (tool: string) => preapproved.some((grant) => grant.server === TOOL_SERVER_NAME && grant.tool === tool);
    const grants = toolNames.filter((tool) => !granted(tool)).map((tool) => ({ kind: "mcp" as const, server: TOOL_SERVER_NAME, tool }));
    return { ...request, config: { ...config, toolPolicy: { ...config.toolPolicy, preapproved: [...preapproved, ...grants] } } };
  }

  return { withToolServer, withPreapprovedTools, stop };
}
