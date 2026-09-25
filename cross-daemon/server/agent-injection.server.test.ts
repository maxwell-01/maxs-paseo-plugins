import { describe, expect, it } from "vitest";
import { withCrossDaemonTools } from "./agent-injection.server";

const launch = { command: "/usr/local/bin/node", proxyPath: "/home/p/.paseo/plugin-data/cross-daemon/tool-proxy.cjs", socketPath: "/home/p/.paseo/plugin-data/cross-daemon/tools.sock" };

describe("withCrossDaemonTools", () => {
  it("gives the agent the cross-daemon tool server, reaching the plugin through its socket", () => {
    const config = withCrossDaemonTools({ provider: "claude", cwd: "/repo" }, launch, ["list_daemons"]);
    expect(config.mcpServers?.["cross-daemon"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/node",
      args: [launch.proxyPath],
      env: { CROSS_DAEMON_TOOL_SOCKET: launch.socketPath, ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("pre-approves the cross-daemon tools so an unattended agent is not stopped by a permission prompt", () => {
    const config = withCrossDaemonTools({ provider: "claude", cwd: "/repo" }, launch, ["list_daemons", "list_agents"]);
    expect(config.toolPolicy?.preapproved).toEqual([
      { kind: "mcp", server: "cross-daemon", tool: "list_daemons" },
      { kind: "mcp", server: "cross-daemon", tool: "list_agents" },
    ]);
  });

  it("keeps the agent's other tool servers and approvals", () => {
    const github = { type: "stdio" as const, command: "gh-mcp" };
    const grant = { kind: "mcp" as const, server: "github", tool: "search" };
    const config = withCrossDaemonTools(
      { provider: "claude", cwd: "/repo", mcpServers: { github }, toolPolicy: { preapproved: [grant] } },
      launch,
      ["list_daemons"],
    );
    expect(config.mcpServers?.github).toBe(github);
    expect(config.toolPolicy?.preapproved[0]).toBe(grant);
  });
});
