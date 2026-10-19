import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";

interface BotApiCall {
  method: string;
  body: Record<string, unknown>;
}

type Reply = { status?: number; json: unknown };

const defaultReply = (method: string): Reply => ({ json: { ok: true, result: method === "getUpdates" ? [] : true } });

function send(response: ServerResponse, { status = 200, json }: Reply) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
}

export async function startFakeBotApi(token: string) {
  const calls: BotApiCall[] = [];
  const replies = new Map<string, Reply[]>();
  const prefix = `/bot${token}/`;
  function answer(url: string | undefined, raw: string): Reply {
    if (!url?.startsWith(prefix)) return { status: 401, json: { ok: false, error_code: 401, description: "Unauthorized" } };
    const method = url.slice(prefix.length);
    calls.push({ method, body: raw ? JSON.parse(raw) : {} });
    return replies.get(method)?.shift() ?? defaultReply(method);
  }
  const server = createServer((request, response) => {
    void text(request).then((raw) => {
      try {
        send(response, answer(request.url, raw));
      } catch (error) {
        send(response, { status: 400, json: { ok: false, error_code: 400, description: String(error) } });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    reply(method: string, ...queued: Reply[]) {
      replies.set(method, [...(replies.get(method) ?? []), ...queued]);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
export type FakeBotApi = Awaited<ReturnType<typeof startFakeBotApi>>;
