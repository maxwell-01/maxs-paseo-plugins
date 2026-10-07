import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "./tools.server";

const PROXY_FILE = "tool-proxy.cjs";
const OWNER_ONLY_DIR = 0o700;

// The MCP server an agent's provider launches, and also a command (`node tool-proxy.cjs <tool> [--wait N]`)
// for agents without it. It lists its tools itself and forwards each call to the plugin over a local
// socket, so the tools' logic lives in the long-running plugin process. The daemon evaluates plugin
// code in memory, so this function is written out as a standalone script and must not reference
// anything outside itself.
function toolProxyMain(settings: { socketPath: string; tools: unknown[]; pluginTimeoutMs: number }): void {
  const net: typeof import("node:net") = require("node:net");
  const readline: typeof import("node:readline") = require("node:readline");
  const callerAgentId = process.env.PASEO_AGENT_ID ?? null;
  const pluginTimeoutMs = settings.pluginTimeoutMs;
  const pendingCalls = new Map<unknown, import("node:net").Socket>();

  const askPlugin = (request: object, requestId: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let reply = "";
      const socket = net.createConnection(settings.socketPath);
      pendingCalls.set(requestId, socket);
      socket.setEncoding("utf8");
      socket.setTimeout(pluginTimeoutMs, () => {
        socket.destroy();
        resolve({
          error: `The beam plugin did not answer within ${pluginTimeoutMs / 1000} s. This agent may already hold the beam; call beam_status before trying again.`,
        });
      });
      socket.on("data", (chunk: string) => {
        reply += chunk;
      });
      socket.on("end", () => {
        try {
          resolve(JSON.parse(reply));
        } catch {
          resolve({ error: `Unreadable reply from the beam plugin: ${reply.slice(0, 200)}` });
        }
      });
      socket.on("error", (error: Error) => resolve({ error: `The beam plugin is not running: ${error.message}` }));
      socket.on("close", () => resolve({ error: "The connection to the beam plugin closed before it answered." }));
      socket.write(`${JSON.stringify(request)}\n`);
    });

  const callPlugin = async (name: unknown, args: unknown, requestId: unknown) => {
    const answer = await askPlugin({ type: "call", name, arguments: args ?? {}, callerAgentId }, requestId);
    return {
      text: typeof answer.text === "string" ? answer.text : String(answer.error ?? "No reply"),
      isError: answer.isError === true || answer.error !== undefined,
    };
  };

  const runCommand = async (args: string[]) => {
    const [tool, flag, seconds] = args;
    const usage = (message: string) => {
      process.stderr.write(`${message}\nUsage: node tool-proxy.cjs <tool> [--wait <seconds>]\n`);
      process.exitCode = 2;
    };
    if (tool.startsWith("--")) return usage("Missing tool name.");
    if (args.length !== 1 && !(args.length === 3 && flag === "--wait" && /^\d+$/.test(seconds))) return usage("Unrecognised arguments.");
    const result = await callPlugin(tool, args.length === 3 ? { waitSeconds: Number(seconds) } : {}, "command");
    process.stdout.write(`${result.text}\n`);
    process.exitCode = result.isError ? 1 : 0;
  };

  const commandArgs = process.argv.slice(2);
  if (commandArgs.length > 0) {
    void runCommand(commandArgs);
    return;
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  readline.createInterface({ input: process.stdin }).on("line", async (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(null, -32700, "Parse error");
      return;
    }
    if (!isRecord(parsed)) {
      fail(null, -32600, "Invalid request");
      return;
    }
    const message = parsed;
    const params = isRecord(message.params) ? message.params : {};
    if (message.method === "notifications/cancelled") {
      const cancelled = pendingCalls.get(params.requestId);
      pendingCalls.delete(params.requestId);
      cancelled?.destroy();
      return;
    }
    if (message.id === undefined) return;
    const reply = (result: object) => send({ jsonrpc: "2.0", id: message.id, result });

    if (message.method === "initialize") {
      reply({
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "beam", version: "1" },
      });
    } else if (message.method === "ping") {
      reply({});
    } else if (message.method === "tools/list") {
      reply({ tools: settings.tools });
    } else if (message.method === "tools/call") {
      const result = await callPlugin(params.name, params.arguments, message.id);
      if (!pendingCalls.delete(message.id)) return;
      reply({ content: [{ type: "text", text: result.text }], isError: result.isError });
    } else {
      fail(message.id, -32601, `Method not found: ${String(message.method)}`);
    }
  });
}

// Agents keep the path in their saved config, so it stays the same across plugin updates; the
// content is refreshed at every plugin start.
export function installToolProxy(stateDir: string, settings: { socketPath: string; tools: readonly ToolDefinition[]; pluginTimeoutMs: number }): string {
  const proxyPath = join(stateDir, PROXY_FILE);
  const source = `(${toolProxyMain.toString()})(${JSON.stringify(settings)});\n`;
  if (existsSync(proxyPath) && readFileSync(proxyPath, "utf8") === source) return proxyPath;
  mkdirSync(stateDir, { recursive: true, mode: OWNER_ONLY_DIR });
  const staging = `${proxyPath}.${process.pid}.tmp`;
  writeFileSync(staging, source);
  renameSync(staging, proxyPath);
  return proxyPath;
}
