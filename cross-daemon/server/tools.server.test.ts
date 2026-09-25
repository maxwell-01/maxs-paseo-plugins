import { describe, expect, it } from "vitest";
import { createTools } from "./tools.server";

const unusedCli = {
  run: async () => {
    throw new Error("list_daemons must not call the CLI");
  },
};
const mac = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=mac" };

describe("list_daemons", () => {
  it("lists the reachable daemons by name and server ID, never by link", async () => {
    const tools = createTools({ readPeers: () => [mac], cli: unusedCli });
    const result = await tools.call("list_daemons", {}, { callerAgentId: "agent-1" });
    expect(JSON.parse(result.text)).toEqual({ daemons: [{ name: "mac", serverId: "srv_mac" }] });
    expect(result.text).not.toContain("offer=");
  });

  it("explains how to connect a daemon when none are reachable", async () => {
    const tools = createTools({ readPeers: () => [], cli: unusedCli });
    const result = await tools.call("list_daemons", {}, { callerAgentId: "agent-1" });
    expect(result.text).toContain("Allow cross-daemon comms");
    expect(result.isError).toBeFalsy();
  });
});

describe("tool calls", () => {
  it("rejects a tool it does not have", async () => {
    const tools = createTools({ readPeers: () => [], cli: unusedCli });
    await expect(tools.call("drop_tables", {}, { callerAgentId: null })).resolves.toEqual({
      text: "Unknown cross-daemon tool: drop_tables",
      isError: true,
    });
  });

  it("publishes each tool with a JSON input schema", () => {
    const tools = createTools({ readPeers: () => [], cli: unusedCli });
    expect(tools.definitions.map((tool) => tool.name)).toEqual(["list_daemons", "list_workspaces", "list_agents", "get_agent_activity"]);
    expect(tools.definitions[0].inputSchema).toMatchObject({ type: "object" });
  });
});
