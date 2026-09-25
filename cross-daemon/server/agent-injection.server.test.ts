import { describe, expect, it } from "vitest";
import { withCrossDaemonTools } from "./agent-injection.server";

const launch = { command: "/usr/local/bin/node", proxyPath: "/home/p/.paseo/plugin-data/cross-daemon/tool-proxy.cjs" };

describe("withCrossDaemonTools", () => {
  it("gives a Claude agent the cross-daemon tool server", () => {
    const config = withCrossDaemonTools({ provider: "claude", cwd: "/repo" }, launch, ["list_daemons"]);
    expect(config.mcpServers?.["cross-daemon"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/node",
      args: [launch.proxyPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("pre-approves the tools for Claude and Codex, so an unattended agent is not stopped by a permission prompt", () => {
    for (const provider of ["claude", "codex"]) {
      const config = withCrossDaemonTools({ provider, cwd: "/repo" }, launch, ["list_daemons", "list_agents"]);
      expect(config.toolPolicy?.preapproved).toEqual([
        { kind: "mcp", server: "cross-daemon", tool: "list_daemons" },
        { kind: "mcp", server: "cross-daemon", tool: "list_agents" },
      ]);
    }
  });

  it("gives OpenCode the tools without a tool policy, which would switch off its auto-accept", () => {
    const config = withCrossDaemonTools({ provider: "opencode", cwd: "/repo" }, launch, ["list_daemons"]);
    expect(config.mcpServers?.["cross-daemon"]).toBeDefined();
    expect(config.toolPolicy).toBeUndefined();
  });

  it("leaves other providers unchanged, since Paseo refuses to create them with these tools", () => {
    for (const provider of ["copilot", "pi", "cursor"]) {
      const original = { provider, cwd: "/repo" };
      expect(withCrossDaemonTools(original, launch, ["list_daemons"])).toBe(original);
    }
  });

  it("keeps the agent's other tool servers and approvals, without granting a tool twice", () => {
    const github = { type: "stdio" as const, command: "gh-mcp" };
    const grant = { kind: "mcp" as const, server: "github", tool: "search" };
    const ours = { kind: "mcp" as const, server: "cross-daemon", tool: "list_daemons" };
    const config = withCrossDaemonTools(
      { provider: "claude", cwd: "/repo", mcpServers: { github }, toolPolicy: { preapproved: [grant, ours] } },
      launch,
      ["list_daemons"],
    );
    expect(config.mcpServers?.github).toBe(github);
    expect(config.toolPolicy?.preapproved).toEqual([grant, ours]);
  });
});
