import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dir.test-support";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";
import type { Tools } from "./tools.server";

const echoTools: Tools = {
  definitions: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
  async call(name, args, caller) {
    if (name === "fail") return { text: "it went wrong", isError: true };
    return { text: JSON.stringify({ name, args, callerAgentId: caller.callerAgentId }) };
  },
};

function startProxy(proxyPath: string, agentId: string) {
  const child = spawn(process.execPath, [proxyPath], { env: { ...process.env, PASEO_AGENT_ID: agentId } });
  const replies = createInterface({ input: child.stdout });
  const pending = new Map<number, (reply: any) => void>();
  replies.on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
  });
  let nextId = 1;
  const notify = (method: string, params: unknown = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const start = (method: string, params: unknown = {}) => {
    const id = nextId++;
    const reply = new Promise<{ result?: any; error?: { code: number; message: string } }>((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    return { id, reply };
  };
  const request = (method: string, params: unknown = {}) => start(method, params).reply;
  const sendRaw = (line: string) =>
    new Promise<any>((resolve) => {
      replies.once("line", (reply) => resolve(JSON.parse(reply)));
      child.stdin.write(`${line}\n`);
    });
  return { child, request, start, notify, sendRaw };
}

function runCli(proxyPath: string, args: string[]) {
  const child = spawn(process.execPath, [proxyPath, ...args], { env: { ...process.env, PASEO_AGENT_ID: "agent-cli" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
}

describe("tool proxy started by an agent", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  const install = async (tools: Tools, pluginTimeoutMs = 10_000) => {
    const dir = makeTempDir("beam-");
    const socketPath = join(dir, "tools.sock");
    stops.push(await await serveTools(socketPath, tools));
    return installToolProxy(dir, { socketPath, tools: tools.definitions, pluginTimeoutMs });
  };

  it("lists its tools and forwards calls to the plugin, naming the calling agent", async () => {
    const proxy = startProxy(await install(echoTools), "agent-7");
    stops.push(() => proxy.child.kill());

    const init = await proxy.request("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.name).toBe("beam");
    const list = await proxy.request("tools/list");
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"]);
    const call = await proxy.request("tools/call", { name: "echo", arguments: { waitSeconds: 3 } });
    expect(JSON.parse(call.result.content[0].text)).toEqual({ name: "echo", args: { waitSeconds: 3 }, callerAgentId: "agent-7" });
  });

  it("reports an error to the agent when the plugin is not running", async () => {
    const dir = makeTempDir("beam-");
    const proxy = startProxy(installToolProxy(dir, { socketPath: join(dir, "missing.sock"), tools: echoTools.definitions, pluginTimeoutMs: 10_000 }), "agent-7");
    stops.push(() => proxy.child.kill());
    const list = await proxy.request("tools/list");
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"]);
    const call = await proxy.request("tools/call", { name: "echo", arguments: {} });
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toContain("beam plugin is not running");
  });

  it("answers a line that is not JSON with a parse error instead of dying", async () => {
    const dir = makeTempDir("beam-");
    const proxy = startProxy(installToolProxy(dir, { socketPath: join(dir, "missing.sock"), tools: [], pluginTimeoutMs: 10_000 }), "agent-7");
    stops.push(() => proxy.child.kill());
    expect(await proxy.sendRaw("not json")).toMatchObject({ id: null, error: { code: -32700 } });
    expect(await proxy.sendRaw("null")).toMatchObject({ id: null, error: { code: -32600 } });
    const ping = await proxy.request("ping");
    expect(ping.result).toEqual({});
  });

  it("gives up on a plugin that does not answer within the timeout it was installed with", async () => {
    const proxy = startProxy(await install({ definitions: echoTools.definitions, call: () => new Promise(() => {}) }, 200), "agent-7");
    stops.push(() => proxy.child.kill());
    const call = await proxy.request("tools/call", { name: "echo", arguments: {} });
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toContain("did not answer within 0.2 s");
    expect(call.result.content[0].text).toContain("beam_status");
  });

  it("closes the connection of a cancelled call, so the tool's signal aborts and no reply is sent", async () => {
    let started!: (signal: AbortSignal) => void;
    const toolSignal = new Promise<AbortSignal>((resolve) => (started = resolve));
    const proxy = startProxy(
      await install({
        definitions: echoTools.definitions,
        call: (_name, _args, caller) =>
          new Promise((resolve) => {
            started(caller.signal);
            caller.signal.addEventListener("abort", () => resolve({ text: "aborted" }));
          }),
      }),
      "agent-7",
    );
    stops.push(() => proxy.child.kill());

    const call = proxy.start("tools/call", { name: "echo", arguments: {} });
    const signal = await toolSignal;
    proxy.notify("notifications/cancelled", { requestId: call.id });
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    expect(signal.aborted).toBe(true);
    const afterwards = await proxy.request("ping");
    expect(afterwards.result).toEqual({});
  });
});

describe("tool proxy run as a command", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  const install = async () => {
    const dir = makeTempDir("beam-");
    const socketPath = join(dir, "tools.sock");
    stops.push(await serveTools(socketPath, echoTools));
    return installToolProxy(dir, { socketPath, tools: echoTools.definitions, pluginTimeoutMs: 10_000 });
  };

  it("prints the reply and exits 0", async () => {
    const result = await runCli(await install(), ["echo"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ name: "echo", args: {}, callerAgentId: "agent-cli" });
  });

  it("passes --wait as waitSeconds", async () => {
    const result = await runCli(await install(), ["echo", "--wait", "45"]);
    expect(JSON.parse(result.stdout).args).toEqual({ waitSeconds: 45 });
  });

  it("exits 1 when the tool reports an error", async () => {
    const result = await runCli(await install(), ["fail"]);
    expect(result.code).toBe(1);
    expect(result.stdout.trim()).toBe("it went wrong");
  });

  it("exits 1 and says so when the plugin is not running", async () => {
    const dir = makeTempDir("beam-");
    const result = await runCli(installToolProxy(dir, { socketPath: join(dir, "missing.sock"), tools: [], pluginTimeoutMs: 10_000 }), ["echo"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("beam plugin is not running");
  });

  it("prints usage and exits 2 without a tool name", async () => {
    const result = await runCli(await install(), ["--wait", "5"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage");
  });

  it("prints usage and exits 2 when --wait is not a number", async () => {
    const result = await runCli(await install(), ["echo", "--wait", "soon"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage");
  });
});
