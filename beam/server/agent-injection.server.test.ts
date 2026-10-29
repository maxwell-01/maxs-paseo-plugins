import { describe, expect, it } from "vitest";
import { withBeamTools } from "./agent-injection.server";

const launch = { command: "/usr/local/bin/node", proxyPath: "/home/p/.paseo/plugin-data/beam/tool-proxy.cjs" };
const token = "token-1";

describe("withBeamTools", () => {
  it("gives a Claude agent the beam tool server", () => {
    const config = withBeamTools({ provider: "claude", cwd: "/repo" }, launch, ["beam_status"], token);
    expect(config.mcpServers?.["beam"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/node",
      args: [launch.proxyPath],
      env: { ELECTRON_RUN_AS_NODE: "1", BEAM_AGENT_TOKEN: token },
    });
  });

  it("gives a Codex agent the tool server with its token, because Codex hides PASEO_AGENT_ID from MCP servers", () => {
    const config = withBeamTools({ provider: "codex", cwd: "/repo" }, launch, ["beam_status"], token);
    expect(config.mcpServers?.["beam"]).toMatchObject({ command: "/usr/local/bin/node", env: { BEAM_AGENT_TOKEN: token } });
  });

  it("pre-approves the tools for Claude and Codex, so an unattended agent is not stopped by a permission prompt", () => {
    for (const provider of ["claude", "codex"]) {
      const config = withBeamTools({ provider, cwd: "/repo" }, launch, ["beam_status", "beam_in"], token);
      expect(config.toolPolicy?.preapproved).toEqual([
        { kind: "mcp", server: "beam", tool: "beam_status" },
        { kind: "mcp", server: "beam", tool: "beam_in" },
      ]);
    }
  });

  it("gives OpenCode the tools without a tool policy, which would switch off its auto-accept", () => {
    const config = withBeamTools({ provider: "opencode", cwd: "/repo" }, launch, ["beam_status"], token);
    expect(config.mcpServers?.["beam"]).toBeDefined();
    expect(config.toolPolicy).toBeUndefined();
  });

  it("leaves other providers unchanged, because Paseo refuses their MCP servers", () => {
    for (const provider of ["copilot", "pi", "cursor"]) {
      const original = { provider, cwd: "/repo" };
      expect(withBeamTools(original, launch, ["beam_status"], token)).toBe(original);
    }
  });

  it("keeps the agent's other tool servers and approvals, without granting a tool twice", () => {
    const github = { type: "stdio" as const, command: "gh-mcp" };
    const grant = { kind: "mcp" as const, server: "github", tool: "search" };
    const ours = { kind: "mcp" as const, server: "beam", tool: "beam_status" };
    const config = withBeamTools(
      { provider: "claude", cwd: "/repo", mcpServers: { github }, toolPolicy: { preapproved: [grant, ours] } },
      launch,
      ["beam_status"],
      token,
    );
    expect(config.mcpServers?.github).toBe(github);
    expect(config.toolPolicy?.preapproved).toEqual([grant, ours]);
  });
});
