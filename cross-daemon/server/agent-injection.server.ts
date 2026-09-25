import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";

export const TOOL_SERVER_NAME = "cross-daemon";

export interface ToolServerLaunch {
  command: string;
  proxyPath: string;
  socketPath: string;
}

export function withCrossDaemonTools(
  config: AgentSessionConfig,
  launch: ToolServerLaunch,
  toolNames: readonly string[],
): AgentSessionConfig {
  const preapproved = config.toolPolicy?.preapproved ?? [];
  return {
    ...config,
    mcpServers: {
      ...config.mcpServers,
      [TOOL_SERVER_NAME]: {
        type: "stdio",
        command: launch.command,
        args: [launch.proxyPath],
        // Paseo's desktop daemon runs under Electron, whose binary runs a script only in Node mode.
        env: { CROSS_DAEMON_TOOL_SOCKET: launch.socketPath, ELECTRON_RUN_AS_NODE: "1" },
      },
    },
    toolPolicy: {
      ...config.toolPolicy,
      preapproved: [...preapproved, ...toolNames.map((tool) => ({ kind: "mcp" as const, server: TOOL_SERVER_NAME, tool }))],
    },
  };
}
