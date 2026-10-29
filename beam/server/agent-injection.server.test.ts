import { describe, expect, it } from "vitest";
import { withBeamTools } from "./agent-injection.server";

const launch = { command: "/usr/local/bin/node", proxyPath: "/home/p/.paseo/plugin-data/beam/tool-proxy.cjs" };
const create = (provider: string) => ({ config: { provider, cwd: "/repo" }, env: { PATH: "/bin" } });

describe("withBeamTools", () => {
  it("gives a Claude agent the beam tool server, which finds the agent through PASEO_AGENT_ID", () => {
    const request = withBeamTools(create("claude"), launch, ["beam_status"]);
    expect(request.config.mcpServers?.["beam"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/node",
      args: [launch.proxyPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(request.env).toEqual({ PATH: "/bin" });
  });

  it("gives a Codex agent's tool server and its session the same new token, because Codex hides PASEO_AGENT_ID from MCP servers", () => {
    const first = withBeamTools(create("codex"), launch, ["beam_status"]);
    const second = withBeamTools(create("codex"), launch, ["beam_status"]);
    const beamServerOf = (request: typeof first) => request.config.mcpServers?.["beam"];

    expect(beamServerOf(first)).toMatchObject({ command: "/usr/local/bin/node", env: { BEAM_AGENT_TOKEN: first.env?.BEAM_AGENT_TOKEN } });
    expect(first.env).toEqual({ PATH: "/bin", BEAM_AGENT_TOKEN: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(second.env?.BEAM_AGENT_TOKEN).not.toBe(first.env?.BEAM_AGENT_TOKEN);
  });

  it("pre-approves the tools for Claude and Codex, so an unattended agent is not stopped by a permission prompt", () => {
    for (const provider of ["claude", "codex"]) {
      const { config } = withBeamTools(create(provider), launch, ["beam_status", "beam_in"]);
      expect(config.toolPolicy?.preapproved).toEqual([
        { kind: "mcp", server: "beam", tool: "beam_status" },
        { kind: "mcp", server: "beam", tool: "beam_in" },
      ]);
    }
  });

  it("gives OpenCode the tools without a tool policy, which would switch off its auto-accept", () => {
    const { config } = withBeamTools(create("opencode"), launch, ["beam_status"]);
    expect(config.mcpServers?.["beam"]).toBeDefined();
    expect(config.toolPolicy).toBeUndefined();
  });

  it("leaves other providers unchanged, because Paseo refuses their MCP servers", () => {
    for (const provider of ["copilot", "pi", "cursor"]) {
      const original = create(provider);
      expect(withBeamTools(original, launch, ["beam_status"])).toBe(original);
    }
  });

  it("keeps the agent's other tool servers and approvals, without granting a tool twice", () => {
    const github = { type: "stdio" as const, command: "gh-mcp" };
    const grant = { kind: "mcp" as const, server: "github", tool: "search" };
    const ours = { kind: "mcp" as const, server: "beam", tool: "beam_status" };
    const { config } = withBeamTools(
      { config: { provider: "claude", cwd: "/repo", mcpServers: { github }, toolPolicy: { preapproved: [grant, ours] } } },
      launch,
      ["beam_status"],
    );
    expect(config.mcpServers?.github).toBe(github);
    expect(config.toolPolicy?.preapproved).toEqual([grant, ours]);
  });
});
