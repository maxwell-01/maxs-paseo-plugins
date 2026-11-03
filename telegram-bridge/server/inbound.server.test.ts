import { describe, expect, it } from "vitest";
import type { Attachments } from "./attachments.server";
import { isUnsupportedContent } from "./content-kinds.server";
import { hasContentForAgent, historyEntryFor, paseoMessageId, promptFor, replyHint } from "./inbound.server";
import type { TelegramMessage } from "./telegram-api.server";

const message = (fields: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 17,
  chat: { id: -100200, type: "supergroup", title: "Home Server AI" },
  from: { id: 1, first_name: "Max" },
  ...fields,
});
const photo = [{ file_id: "small" }, { file_id: "large" }];
const none: Attachments = { images: [], savedFiles: [], notes: [] };
const HISTORY = "/data/history/-100200.log";

describe("inbound formatting", () => {
  it("names Telegram, the sender and the group, and says where the reply goes, how to send a file and how to follow up", () => {
    expect(promptFor(message({ text: "Is the deploy done?" }), none, HISTORY)).toBe(`[Telegram, Max, in Home Server AI]: Is the deploy done?\n${replyHint(-100200, HISTORY)}`);
    expect(replyHint(-100200, HISTORY)).toContain("[[send: /absolute/path]]");
    expect(replyHint(-100200, HISTORY)).toContain("[[telegram: -100200]]");
    expect(replyHint(-100200, HISTORY)).toContain(`recent messages, yours included, are in ${HISTORY}`);
  });

  it("names a private chat as the direct chat", () => {
    expect(promptFor(message({ chat: { id: 1, type: "private" }, text: "hi" }), none, HISTORY).split("\n")[0]).toBe("[Telegram, Max, in direct chat]: hi");
  });

  it("uses a photo's caption as the message", () => {
    expect(promptFor(message({ photo, caption: "Which plant is this?" }), none, HISTORY)).toBe(`[Telegram, Max, in Home Server AI]: Which plant is this?\n${replyHint(-100200, HISTORY)}`);
  });

  it("says a photo or file came without a caption", () => {
    expect(promptFor(message({ photo }), none, HISTORY).split("\n")[0]).toBe("[Telegram, Max, in Home Server AI]: (sent a photo)");
    expect(promptFor(message({ document: { file_id: "d" } }), none, HISTORY).split("\n")[0]).toBe("[Telegram, Max, in Home Server AI]: (sent a file)");
  });

  it("lists each saved file's path and type, and any note", () => {
    const prompt = promptFor(message({ document: { file_id: "d" }, caption: "logs" }), {
      images: [],
      savedFiles: [{ path: "/data/files/-100200/17-app.log", mimeType: "text/plain" }],
      notes: ["big.zip is over Telegram's 20 MB bot download limit, so it was not fetched."],
    }, HISTORY);
    expect(prompt).toBe(
      [
        "[Telegram, Max, in Home Server AI]: logs",
        "Attached file: /data/files/-100200/17-app.log (text/plain)",
        "(big.zip is over Telegram's 20 MB bot download limit, so it was not fetched.)",
        replyHint(-100200, HISTORY),
      ].join("\n"),
    );
  });

  it("tells content for the agent from kinds it cannot take and from service messages", () => {
    expect(hasContentForAgent(message({ photo }))).toBe(true);
    expect(hasContentForAgent(message({ sticker: { file_id: "s" } }))).toBe(false);
    expect(hasContentForAgent(message({ voice: { file_id: "v", duration: 3 } }))).toBe(true);
    expect(isUnsupportedContent(message({ audio: { file_id: "a" } }))).toBe(true);
    expect(isUnsupportedContent(message({ pinned_message: { message_id: 1 } }))).toBe(false);
  });

  it("records who wrote in which chat, the text, and the names of attachments", () => {
    expect(historyEntryFor(message({ text: "Is the deploy done?" }))).toEqual({ who: "Max in Home Server AI", text: "Is the deploy done?" });
    expect(historyEntryFor(message({ photo, caption: "this plant", document: { file_id: "d", file_name: "notes.pdf" } })).text).toBe("this plant [attached: photo, notes.pdf]");
    expect(historyEntryFor(message({ chat: { id: 1, type: "private" }, document: { file_id: "d" } }))).toEqual({ who: "Max in direct chat", text: "(sent a file) [attached: file]" });
  });

  it("gives each chat's message its own Paseo message id", () => {
    expect(paseoMessageId(message({}))).toBe("telegram--100200-17");
  });
});
