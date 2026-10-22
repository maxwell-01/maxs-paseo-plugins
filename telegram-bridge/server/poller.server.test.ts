import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.test-support";
import { createOffsetStore } from "./offset-store.server";
import { runPoller } from "./poller.server";
import { createTelegramApi, type TelegramMessage } from "./telegram-api.server";
import { makeTempDir } from "./temp-dir.test-support";

const TOKEN = "123:test-token";
const chat = { id: -100200, type: "supergroup" };
const update = (updateId: number, text: string) => ({ update_id: updateId, message: { message_id: updateId, chat, from: { id: 1, first_name: "Max" }, text } });

let bot: FakeBotApi;
beforeEach(async () => {
  bot = await startFakeBotApi(TOKEN);
});
afterEach(() => bot.close());

function poll({ stopAfterMessages = Infinity, stopAfterLogs = Infinity, file = join(makeTempDir("tg-poll-"), "state.json") } = {}) {
  const controller = new AbortController();
  const messages: TelegramMessage[] = [];
  const logs: string[] = [];
  const offsets = createOffsetStore(file);
  const offsetsSeenOnDelivery: number[] = [];
  const done = runPoller({
    api: createTelegramApi({ token: TOKEN, baseUrl: bot.url }),
    offsets,
    signal: controller.signal,
    retryDelayMs: () => 1,
    async onMessage(message) {
      offsetsSeenOnDelivery.push(offsets.read());
      messages.push(message);
      if (messages.length >= stopAfterMessages) controller.abort();
    },
    log(line) {
      logs.push(line);
      if (logs.length >= stopAfterLogs) controller.abort();
    },
  });
  return { done, messages, logs, offsets, offsetsSeenOnDelivery };
}

describe("poller against a local Bot API server", () => {
  it("hands over each message and saves the offset past it", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(7, "one"), update(8, "two")] } });
    const run = poll({ stopAfterMessages: 2 });
    await run.done;
    expect(run.messages.map((message) => message.text)).toEqual(["one", "two"]);
    expect(run.offsets.read()).toBe(9);
    expect(bot.calls[0]).toEqual({ method: "getUpdates", body: { offset: 0, timeout: 50, allowed_updates: ["message"] } });
  });

  it("saves the offset before handing over a message, so a crash mid-delivery drops it rather than repeating it", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(7, "one")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.offsetsSeenOnDelivery).toEqual([8]);
  });

  it("resumes from the saved offset after a restart", async () => {
    const file = join(makeTempDir("tg-poll-"), "state.json");
    createOffsetStore(file).write(9);
    bot.reply("getUpdates", { json: { ok: true, result: [update(9, "three")] } });
    await poll({ stopAfterMessages: 1, file }).done;
    expect(bot.calls[0].body.offset).toBe(9);
  });

  it("skips a message of an unexpected shape and keeps going", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [{ update_id: 3, message: { surprise: true } }, update(4, "fine")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.messages.map((message) => message.text)).toEqual(["fine"]);
  });

  it("skips an update with no usable id and still moves past the ones after it", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [{ update_id: "x" }, update(5, "fine")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.messages.map((message) => message.text)).toEqual(["fine"]);
    expect(run.offsets.read()).toBe(6);
  });

  it("stops mid-batch once aborted", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(1, "one"), update(2, "two")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.messages.map((message) => message.text)).toEqual(["one"]);
    expect(run.offsets.read()).toBe(2);
  });

  it("logs a server error with the token redacted, then retries", async () => {
    bot.reply("getUpdates", { status: 502, json: { ok: false, error_code: 502, description: `Bad Gateway for ${TOKEN}` } }, { json: { ok: true, result: [update(1, "after")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.logs).toEqual(["telegram-bridge: getUpdates failed: 502 Bad Gateway for <bot token>. Retrying in 0 s"]);
    expect(run.messages.map((message) => message.text)).toEqual(["after"]);
  });

  it("waits as long as Telegram asks after a 429", async () => {
    bot.reply("getUpdates", { status: 429, json: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } } });
    const run = poll({ stopAfterLogs: 1 });
    await run.done;
    expect(run.logs).toEqual(["telegram-bridge: getUpdates failed: 429 Too Many Requests. Retrying in 7 s"]);
  });

  it("says once that another poller holds the token", async () => {
    const conflict = { status: 409, json: { ok: false, error_code: 409, description: "Conflict" } };
    bot.reply("getUpdates", conflict, conflict, conflict, { json: { ok: true, result: [update(1, "after")] } });
    const run = poll({ stopAfterMessages: 1 });
    await run.done;
    expect(run.logs).toEqual(["telegram-bridge: another program is polling this bot token; only one can. Retrying in 0 s"]);
  });

  it("logs a refused connection without throwing", async () => {
    await bot.close();
    const run = poll({ stopAfterLogs: 1 });
    await expect(run.done).resolves.toBeUndefined();
    expect(run.logs[0]).toMatch(/^telegram-bridge: getUpdates failed: TypeError: fetch failed\. Retrying/);
    expect(run.logs[0]).not.toContain(TOKEN);
  });
});
