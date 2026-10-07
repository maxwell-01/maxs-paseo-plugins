import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dir.test-support";
import { serveTools } from "./tool-socket.server";
import type { Tools } from "./tools.server";

const request = (name: string, callerAgentId: string | null = null) =>
  `${JSON.stringify({ type: "call", name, arguments: {}, callerAgentId })}\n`;

function connect(socketPath: string): Promise<Socket> {
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = createConnection(socketPath);
      socket.setEncoding("utf8");
      socket.once("connect", () => resolve(socket));
      socket.once("error", () => setTimeout(attempt, 20));
    };
    attempt();
  });
}

const readReply = (socket: Socket) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    socket.on("data", (chunk) => (body += chunk));
    socket.on("end", () => resolve(body));
    socket.on("error", reject);
  });

describe("serveTools", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  const serve = async (tools: Tools) => {
    const socketPath = join(makeTempDir("beam-"), "not-yet", "tools.sock");
    stops.push(await serveTools(socketPath, tools));
    return socketPath;
  };

  it("starts on a fresh install and answers the first line without the client closing its side", async () => {
    const socketPath = await serve({ definitions: [], call: async (name, _args, caller) => ({ text: `${name} for ${caller.callerAgentId}` }) });
    const socket = await connect(socketPath);
    const reply = readReply(socket);
    socket.write(request("ping", "agent-1"));
    expect(JSON.parse(await reply)).toEqual({ text: "ping for agent-1" });
  });

  it("rejects when it cannot listen", async () => {
    const tooLongForASocket = join(makeTempDir("beam-"), "x".repeat(200), "tools.sock");
    await expect(serveTools(tooLongForASocket, { definitions: [], call: async () => ({ text: "" }) })).rejects.toThrow();
  });

  it("answers a malformed request with an error", async () => {
    const socketPath = await serve({ definitions: [], call: async () => ({ text: "unreachable" }) });
    const socket = await connect(socketPath);
    const reply = readReply(socket);
    socket.write('{"type":"nope"}\n');
    expect(JSON.parse(await reply).error).toContain("Malformed tool request");
  });

  it("answers a line that is not JSON with an error", async () => {
    const socketPath = await serve({ definitions: [], call: async () => ({ text: "unreachable" }) });
    const socket = await connect(socketPath);
    const reply = readReply(socket);
    socket.write("not json\n");
    expect(JSON.parse(await reply).error).toContain("Unreadable tool request");
  });

  it("reports a throwing tool as an error result", async () => {
    const socketPath = await serve({
      definitions: [],
      call: async () => {
        throw new Error("boom");
      },
    });
    const socket = await connect(socketPath);
    const reply = readReply(socket);
    socket.write(request("bad"));
    expect(JSON.parse(await reply)).toEqual({ text: expect.stringContaining("boom"), isError: true });
  });

  it("aborts the tool's signal when the client disconnects before the reply", async () => {
    let started!: (signal: AbortSignal) => void;
    const toolSignal = new Promise<AbortSignal>((resolve) => (started = resolve));
    const socketPath = await serve({
      definitions: [],
      call: (_name, _args, caller) =>
        new Promise((resolve) => {
          started(caller.signal);
          caller.signal.addEventListener("abort", () => resolve({ text: "aborted" }));
        }),
    });
    const socket = await connect(socketPath);
    socket.write(request("wait"));
    const signal = await toolSignal;
    expect(signal.aborted).toBe(false);
    socket.destroy();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    expect(signal.aborted).toBe(true);
  });
});
