import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.test-support";
import { sendReply } from "./send-reply.server";
import { createTelegramApi } from "./telegram-api.server";
import { makeTempDir } from "./temp-dir.test-support";

const TOKEN = "123:reply-token";
const CHAT = -100200;
const threaded = { message_id: 5, allow_sending_without_reply: true };
let bot: FakeBotApi;
beforeEach(async () => {
  bot = await startFakeBotApi(TOKEN);
});
afterEach(() => bot.close());

function file(name: string) {
  const path = join(makeTempDir("tg-reply-"), name);
  writeFileSync(path, name);
  return path;
}
const send = (body: string, files: Array<{ path: string; kind: "photo" | "document" }>) =>
  sendReply(createTelegramApi({ token: TOKEN, baseUrl: bot.url }), { chatId: CHAT, replyTo: 5 }, { body, files });
const summary = () => bot.calls.map(({ method, body }) => [method, body.reply_parameters ?? null]);

describe("sending a reply", () => {
  it("threads the first file to the message when the reply has no text", async () => {
    await send("", [{ path: file("a.pdf"), kind: "document" }, { path: file("b.pdf"), kind: "document" }]);
    expect(summary()).toEqual([
      ["sendDocument", JSON.stringify(threaded)],
      ["sendDocument", null],
    ]);
  });

  it("sends a photo Telegram refuses as a file instead", async () => {
    bot.reply("sendPhoto", { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: PHOTO_INVALID_DIMENSIONS" } });
    await send("Here.", [{ path: file("long.png"), kind: "photo" }]);
    expect(summary()).toEqual([
      ["sendMessage", threaded],
      ["sendPhoto", null],
      ["sendDocument", null],
    ]);
  });

  it("sends the other files when one fails, then says which did not arrive", async () => {
    const broken = file("broken.pdf");
    bot.reply("sendDocument", { status: 413, json: { ok: false, error_code: 413, description: "Request Entity Too Large" } });
    await send("Two files.", [{ path: broken, kind: "document" }, { path: file("fine.pdf"), kind: "document" }]);
    expect(bot.calls.map((call) => call.method)).toEqual(["sendMessage", "sendDocument", "sendDocument", "sendMessage"]);
    expect(bot.calls[3].body.text).toBe(`Could not send ${broken}: sendDocument failed: 413 Request Entity Too Large`);
  });
});
