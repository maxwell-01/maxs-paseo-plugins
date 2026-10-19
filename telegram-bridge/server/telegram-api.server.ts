import { z } from "zod";

export const TELEGRAM_API_URL = "https://api.telegram.org";
// A long poll whose answer is this late is on a dead connection.
const LONG_POLL_GRACE_SECONDS = 10;
const REQUEST_TIMEOUT_MS = 30_000;

const userSchema = z.object({ id: z.number(), first_name: z.string(), username: z.string().optional() });
const chatSchema = z.object({ id: z.number(), type: z.string(), title: z.string().optional() });
export const messageSchema = z.object({
  message_id: z.number(),
  from: userSchema.optional(),
  chat: chatSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
}).loose();
export type TelegramMessage = z.output<typeof messageSchema>;

const updateSchema = z.object({ update_id: z.number(), message: z.unknown().optional() });
export interface TelegramUpdate {
  updateId: number;
  message?: TelegramMessage;
}

const responseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  error_code: z.number().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function redactToken(text: string, token: string): string {
  return token ? text.replaceAll(token, "<bot token>") : text;
}

export function createTelegramApi({ token, baseUrl = TELEGRAM_API_URL }: { token: string; baseUrl?: string }) {
  async function call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/bot${token}/${method}`, {
        method: "POST",
        signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TelegramApiError(redactToken(`${method} failed: ${String(error)}`, token), 0);
    }
    const reply = responseSchema.safeParse(await response.json().catch(() => undefined)).data;
    if (reply?.ok) return reply.result;
    const description = reply?.description ?? response.statusText;
    throw new TelegramApiError(redactToken(`${method} failed: ${response.status} ${description}`, token), response.status, reply?.parameters?.retry_after);
  }

  return {
    async getUpdates(offset: number, timeoutSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout((timeoutSeconds + LONG_POLL_GRACE_SECONDS) * 1000)]);
      const result = await call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message"] }, deadline);
      return z.array(z.unknown()).parse(result).flatMap((entry) => {
        const update = updateSchema.safeParse(entry).data;
        return update ? [{ updateId: update.update_id, message: messageSchema.safeParse(update.message).data }] : [];
      });
    },
    async sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
      const reply = replyTo === undefined ? {} : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
      await call("sendMessage", { chat_id: chatId, text, ...reply });
    },
  };
}
export type TelegramApi = ReturnType<typeof createTelegramApi>;
