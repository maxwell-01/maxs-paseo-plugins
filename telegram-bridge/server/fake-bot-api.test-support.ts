import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buffer } from "node:stream/consumers";

interface BotApiCall {
  method: string;
  body: Record<string, unknown>;
}

type Reply = { status?: number; json: unknown };

const defaultReply = (method: string): Reply => ({ json: { ok: true, result: method === "getUpdates" ? [] : true } });

function send(response: ServerResponse, { status = 200, json }: Reply) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
}

async function readBody(request: IncomingMessage, raw: Buffer): Promise<Record<string, unknown>> {
  const type = request.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) return raw.length ? JSON.parse(raw.toString()) : {};
  const form = await new Response(raw, { headers: { "content-type": type } }).formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of form) body[key] = typeof value === "string" ? value : { name: value.name, text: await value.text() };
  return body;
}

export async function startFakeBotApi(token: string) {
  const calls: BotApiCall[] = [];
  const replies = new Map<string, Reply[]>();
  const files = new Map<string, Buffer>();
  const prefix = `/bot${token}/`;
  const filePrefix = `/file/bot${token}/`;
  async function answer(request: IncomingMessage, raw: Buffer): Promise<Reply | Buffer> {
    const url = request.url ?? "";
    if (url.startsWith(filePrefix)) return files.get(url.slice(filePrefix.length)) ?? { status: 404, json: { ok: false } };
    if (!url.startsWith(prefix)) return { status: 401, json: { ok: false, error_code: 401, description: "Unauthorized" } };
    const method = url.slice(prefix.length);
    calls.push({ method, body: await readBody(request, raw) });
    return replies.get(method)?.shift() ?? defaultReply(method);
  }
  const server = createServer((request, response) => {
    void buffer(request)
      .then((raw) => answer(request, raw))
      .then((reply) => (Buffer.isBuffer(reply) ? response.end(reply) : send(response, reply)))
      .catch((error: unknown) => send(response, { status: 400, json: { ok: false, error_code: 400, description: String(error) } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    reply(method: string, ...queued: Reply[]) {
      replies.set(method, [...(replies.get(method) ?? []), ...queued]);
    },
    serveFile(fileId: string, bytes: Buffer) {
      const path = `files/${fileId}`;
      files.set(path, bytes);
      this.reply("getFile", { json: { ok: true, result: { file_id: fileId, file_path: path } } });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
export type FakeBotApi = Awaited<ReturnType<typeof startFakeBotApi>>;
