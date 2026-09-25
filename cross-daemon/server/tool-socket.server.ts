import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import { OWNER_ONLY_DIR, OWNER_ONLY_FILE } from "./private-json.server";
import type { Tools } from "./tools.server";


const toolCallSchema = z.object({
  type: z.literal("call"),
  name: z.string(),
  arguments: z.unknown(),
  callerAgentId: z.string().nullable(),
});

async function answer(tools: Tools, body: string): Promise<unknown> {
  const request = toolCallSchema.safeParse(JSON.parse(body));
  if (!request.success) return { error: `Malformed tool request: ${z.prettifyError(request.error)}` };
  try {
    return await tools.call(request.data.name, request.data.arguments ?? {}, { callerAgentId: request.data.callerAgentId });
  } catch (error) {
    return { text: `cross-daemon tool ${request.data.name} failed: ${String(error)}`, isError: true };
  }
}

// One request per connection: the tool proxy writes a JSON request and half-closes; the reply is
// the whole response stream.
export function serveTools(socketPath: string, tools: Tools): () => void {
  mkdirSync(dirname(socketPath), { recursive: true, mode: OWNER_ONLY_DIR });
  rmSync(socketPath, { force: true });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      body += chunk;
    });
    socket.on("end", () => {
      answer(tools, body)
        .catch((error: unknown) => ({ error: `Unreadable tool request: ${String(error)}` }))
        .then((reply) => socket.end(JSON.stringify(reply)));
    });
    socket.on("error", (error) => console.warn("cross-daemon: tool connection failed", error));
  });
  server.on("error", (error) => console.error("cross-daemon: the tool socket failed", error));
  server.listen(socketPath, () => chmodSync(socketPath, OWNER_ONLY_FILE));
  return () => {
    server.close();
    rmSync(socketPath, { force: true });
  };
}
