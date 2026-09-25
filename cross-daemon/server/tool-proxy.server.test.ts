import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";
import type { Tools } from "./tools.server";

const echoTools: Tools = {
  definitions: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
  async call(name, args, caller) {
    return { text: JSON.stringify({ name, args, caller }) };
  },
};

function startProxy(proxyPath: string, socketPath: string, agentId: string) {
  const child = spawn(process.execPath, [proxyPath], {
    env: { ...process.env, CROSS_DAEMON_TOOL_SOCKET: socketPath, PASEO_AGENT_ID: agentId },
  });
  const replies = createInterface({ input: child.stdout });
  const pending = new Map<number, (reply: unknown) => void>();
  replies.on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
  });
  let nextId = 1;
  const request = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { child, request };
}

describe("tool proxy started by an agent", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  it("forwards tool listing and calls to the plugin, naming the calling agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cd-"));
    const socketPath = join(dir, "tools.sock");
    stops.push(serveTools(socketPath, echoTools));
    const proxy = startProxy(installToolProxy(dir), socketPath, "agent-7");
    stops.push(() => proxy.child.kill());

    const init = await proxy.request("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    const list = await proxy.request("tools/list");
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"]);
    const call = await proxy.request("tools/call", { name: "echo", arguments: { daemon: "mac" } });
    expect(JSON.parse(call.result.content[0].text)).toEqual({
      name: "echo",
      args: { daemon: "mac" },
      caller: { callerAgentId: "agent-7" },
    });
  });

  it("reports an error to the agent when the plugin is not running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cd-"));
    const proxy = startProxy(installToolProxy(dir), join(dir, "missing.sock"), "agent-7");
    stops.push(() => proxy.child.kill());
    const call = await proxy.request("tools/call", { name: "echo", arguments: {} });
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toContain("cross-daemon plugin is not running");
  });
});
