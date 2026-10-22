import { describe, expect, it } from "vitest";
import type { Attachments } from "./attachments.server";
import { hasContentForAgent, isUnsupportedContent, paseoMessageId, promptFor, REPLY_HINT } from "./inbound.server";
import type { TelegramMessage } from "./telegram-api.server";

const message = (fields: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 17,
  chat: { id: -100200, type: "supergroup", title: "Home Server AI" },
  from: { id: 1, first_name: "Max" },
  ...fields,
});
const photo = [{ file_id: "small" }, { file_id: "large" }];
const none: Attachments = { images: [], savedFiles: [], notes: [] };

describe("inbound formatting", () => {
  it("names Telegram, the sender and the group, and says where the reply goes and how to send a file", () => {
    expect(promptFor(message({ text: "Is the deploy done?" }), none)).toBe(`[Telegram, Max, in Home Server AI]: Is the deploy done?\n${REPLY_HINT}`);
    expect(REPLY_HINT).toContain("[[send: /absolute/path]]");
  });

  it("names a private chat as the direct chat", () => {
    expect(promptFor(message({ chat: { id: 1, type: "private" }, text: "hi" }), none).split("\n")[0]).toBe("[Telegram, Max, in direct chat]: hi");
  });

  it("uses a photo's caption as the message", () => {
    expect(promptFor(message({ photo, caption: "Which plant is this?" }), none)).toBe(`[Telegram, Max, in Home Server AI]: Which plant is this?\n${REPLY_HINT}`);
  });

  it("says a photo or file came without a caption", () => {
    expect(promptFor(message({ photo }), none).split("\n")[0]).toBe("[Telegram, Max, in Home Server AI]: (sent a photo)");
    expect(promptFor(message({ document: { file_id: "d" } }), none).split("\n")[0]).toBe("[Telegram, Max, in Home Server AI]: (sent a file)");
  });

  it("lists each saved file's path and type, and any note", () => {
    const prompt = promptFor(message({ document: { file_id: "d" }, caption: "logs" }), {
      images: [],
      savedFiles: [{ path: "/data/files/-100200/17-app.log", mimeType: "text/plain" }],
      notes: ["big.zip is over Telegram's 20 MB bot download limit, so it was not fetched."],
    });
    expect(prompt).toBe(
      [
        "[Telegram, Max, in Home Server AI]: logs",
        "Attached file: /data/files/-100200/17-app.log (text/plain)",
        "(big.zip is over Telegram's 20 MB bot download limit, so it was not fetched.)",
        REPLY_HINT,
      ].join("\n"),
    );
  });

  it("tells content for the agent from kinds it cannot take and from service messages", () => {
    expect(hasContentForAgent(message({ photo }))).toBe(true);
    expect(hasContentForAgent(message({ sticker: { file_id: "s" } }))).toBe(false);
    expect(isUnsupportedContent(message({ voice: { file_id: "v" } }))).toBe(true);
    expect(isUnsupportedContent(message({ pinned_message: { message_id: 1 } }))).toBe(false);
  });

  it("gives each chat's message its own Paseo message id", () => {
    expect(paseoMessageId(message({}))).toBe("telegram--100200-17");
  });
});
