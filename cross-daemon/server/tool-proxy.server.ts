import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_ONLY_DIR = 0o700;
const PROXY_FILE = "tool-proxy.cjs";

// The MCP server an agent's provider launches. It forwards each tool call to the plugin over a local
// socket, so the tools' logic, and the message queue, live in the long-running plugin process. The
// daemon evaluates plugin code in memory, so this function is written out as a standalone script and
// must not reference anything outside itself.
function toolProxyMain(): void {
  const net: typeof import("node:net") = require("node:net");
  const readline: typeof import("node:readline") = require("node:readline");
  const socketPath = process.env.CROSS_DAEMON_TOOL_SOCKET ?? "";
  const callerAgentId = process.env.PASEO_AGENT_ID ?? null;

  const askPlugin = (request: object) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let reply = "";
      const socket = net.createConnection(socketPath);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        reply += chunk;
      });
      socket.on("end", () => {
        try {
          resolve(JSON.parse(reply));
        } catch {
          resolve({ error: `Unreadable reply from the cross-daemon plugin: ${reply.slice(0, 200)}` });
        }
      });
      socket.on("error", (error: Error) => resolve({ error: `The cross-daemon plugin is not running: ${error.message}` }));
      socket.end(JSON.stringify(request));
    });

  const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);

  readline.createInterface({ input: process.stdin }).on("line", async (line: string) => {
    let message: { id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const reply = (result: object) => send({ jsonrpc: "2.0", id: message.id, result });
    const fail = (text: string) => send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: text } });

    if (message.method === "initialize") {
      reply({
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cross-daemon", version: "1" },
      });
    } else if (message.method === "ping") {
      reply({});
    } else if (message.method === "tools/list") {
      const answer = await askPlugin({ type: "list" });
      if (Array.isArray(answer.tools)) reply({ tools: answer.tools });
      else fail(String(answer.error ?? "The cross-daemon plugin listed no tools"));
    } else if (message.method === "tools/call") {
      const answer = await askPlugin({
        type: "call",
        name: message.params?.name,
        arguments: message.params?.arguments ?? {},
        callerAgentId,
      });
      const text = typeof answer.text === "string" ? answer.text : String(answer.error ?? "No reply");
      reply({ content: [{ type: "text", text }], isError: answer.isError === true || answer.error !== undefined });
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    }
  });
}

// Agents keep the path in their saved config, so it stays the same across plugin updates; the
// content is refreshed at every plugin start.
export function installToolProxy(stateDir: string): string {
  const proxyPath = join(stateDir, PROXY_FILE);
  const source = `(${toolProxyMain.toString()})();\n`;
  if (existsSync(proxyPath) && readFileSync(proxyPath, "utf8") === source) return proxyPath;
  mkdirSync(stateDir, { recursive: true, mode: OWNER_ONLY_DIR });
  const staging = `${proxyPath}.${process.pid}.tmp`;
  writeFileSync(staging, source);
  renameSync(staging, proxyPath);
  return proxyPath;
}
