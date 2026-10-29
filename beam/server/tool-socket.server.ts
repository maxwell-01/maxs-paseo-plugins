import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import type { Tools } from "./tools.server";

const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;

const toolCallSchema = z.object({
  type: z.literal("call"),
  name: z.string(),
  arguments: z.unknown(),
  callerAgentId: z.string().nullable(),
  callerToken: z.string().nullable().optional(),
});

type AgentIdForToken = (token: string) => string | null;

async function answer(tools: Tools, agentIdForToken: AgentIdForToken, line: string, signal: AbortSignal): Promise<unknown> {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch (error) {
    return { error: `Unreadable tool request: ${String(error)}` };
  }
  const request = toolCallSchema.safeParse(body);
  if (!request.success) return { error: `Malformed tool request: ${z.prettifyError(request.error)}` };
  const { name, callerAgentId, callerToken } = request.data;
  try {
    const caller = { callerAgentId: callerAgentId ?? (callerToken ? agentIdForToken(callerToken) : null), signal };
    return await tools.call(name, request.data.arguments ?? {}, caller);
  } catch (error) {
    return { text: `beam tool ${name} failed: ${String(error)}`, isError: true };
  }
}

function serveConnection(tools: Tools, agentIdForToken: AgentIdForToken, socket: Socket): void {
  const disconnected = new AbortController();
  let buffered = "";
  let received = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (received) return;
    buffered += chunk;
    const newline = buffered.indexOf("\n");
    if (newline === -1) return;
    received = true;
    void answer(tools, agentIdForToken, buffered.slice(0, newline), disconnected.signal).then((reply) => {
      if (!disconnected.signal.aborted) socket.end(JSON.stringify(reply));
    });
  });
  socket.on("close", () => disconnected.abort());
  socket.on("error", (error) => {
    console.warn("beam: tool connection failed", error);
    disconnected.abort();
  });
}

// One request per connection: the proxy writes one JSON line and keeps its side open; the reply is
// the whole response stream. If the connection ends before the reply is written, the tool's signal aborts.
export async function serveTools(socketPath: string, tools: Tools, agentIdForToken: AgentIdForToken): Promise<() => void> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: OWNER_ONLY_DIR });
  rmSync(socketPath, { force: true });
  const server = createServer((socket) => serveConnection(tools, agentIdForToken, socket));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (error) => console.error("beam: the tool socket failed", error));
  chmodSync(socketPath, OWNER_ONLY_FILE);
  return () => {
    server.close();
    rmSync(socketPath, { force: true });
  };
}
