import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchAttachments } from "./attachments.server";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.test-support";
import { createTelegramApi, type TelegramMessage } from "./telegram-api.server";
import { makeTempDir } from "./temp-dir.test-support";

const TOKEN = "123:files-token";
let bot: FakeBotApi;
beforeEach(async () => {
  bot = await startFakeBotApi(TOKEN);
});
afterEach(() => bot.close());

const message = (fields: Partial<TelegramMessage>): TelegramMessage => ({ message_id: 9, chat: { id: -100200, type: "supergroup" }, ...fields });
const fetchFor = (fields: Partial<TelegramMessage>, dir = makeTempDir("tg-files-")) =>
  fetchAttachments(createTelegramApi({ token: TOKEN, baseUrl: bot.url }), message(fields), dir, new AbortController().signal);

describe("fetching what a Telegram message carries", () => {
  it("passes the largest size of a photo to the agent as an image", async () => {
    bot.serveFile("large", Buffer.from("jpeg bytes"));
    const attachments = await fetchFor({ photo: [{ file_id: "small" }, { file_id: "large" }] });
    expect(attachments.images).toEqual([{ data: Buffer.from("jpeg bytes").toString("base64"), mimeType: "image/jpeg" }]);
    expect(bot.calls).toEqual([{ method: "getFile", body: { file_id: "large" } }]);
  });

  it("saves a file privately under the data folder, by chat and message", async () => {
    bot.serveFile("doc", Buffer.from("log line"));
    const dir = makeTempDir("tg-files-");
    const attachments = await fetchFor({ document: { file_id: "doc", file_name: "app.log", mime_type: "text/plain" } }, dir);
    const path = join(dir, "-100200", "9-app.log");
    expect(attachments.savedFiles).toEqual([{ path, mimeType: "text/plain" }]);
    expect(readFileSync(path, "utf8")).toBe("log line");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("notes a file over Telegram's 20 MB download limit without fetching it", async () => {
    const attachments = await fetchFor({ document: { file_id: "big", file_name: "big.zip", file_size: 21 * 1024 * 1024 } });
    expect(attachments.notes).toEqual(["big.zip is over Telegram's 20 MB bot download limit, so it was not fetched."]);
    expect(bot.calls).toEqual([]);
  });

  it("notes a download that fails, so the message still reaches the agent", async () => {
    bot.reply("getFile", { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: file is too big" } });
    const attachments = await fetchFor({ photo: [{ file_id: "p" }] });
    expect(attachments.notes).toEqual(["The photo could not be fetched: getFile failed: 400 Bad Request: file is too big"]);
  });

  it.each([
    ["../../etc/passwd", "9-_.._etc_passwd"],
    ["..", "9-file"],
    ["report final.pdf", "9-report_final.pdf"],
  ])("keeps the file name %s inside its chat's folder", async (name, saved) => {
    bot.serveFile("doc", Buffer.from("x"));
    const dir = makeTempDir("tg-files-");
    const attachments = await fetchFor({ document: { file_id: "doc", file_name: name } }, dir);
    expect(attachments.savedFiles.map((file) => file.path)).toEqual([join(dir, "-100200", saved)]);
  });

  it("notes a file it cannot save, so the message still reaches the agent", async () => {
    bot.serveFile("doc", Buffer.from("x"));
    const dir = makeTempDir("tg-files-");
    writeFileSync(join(dir, "-100200"), "a file where the chat folder should be");
    const attachments = await fetchFor({ document: { file_id: "doc", file_name: "a.txt" } }, dir);
    expect(attachments.notes).toEqual([`a.txt could not be saved: EEXIST: file already exists, mkdir '${join(dir, "-100200")}'`]);
  });
});
