import { describe, expect, it } from "vitest";
import { quotedLine } from "./quoted-message.server";
import type { TelegramMessage } from "./telegram-api.server";

const OCT_31_0905 = Date.UTC(2026, 9, 31, 9, 5) / 1000;
const replyingTo = (quoted: Record<string, unknown>): TelegramMessage => ({
  message_id: 20,
  chat: { id: -100200, type: "supergroup" },
  text: "yes, that one",
  reply_to_message: { message_id: 19, chat: { id: -100200, type: "supergroup" }, from: { id: 2, first_name: "Bob" }, date: OCT_31_0905, ...quoted },
});

describe("the line that quotes the message replied to", () => {
  it("names the sender and time, and quotes the text", () => {
    expect(quotedLine(replyingTo({ text: "Restart the box?" }))).toBe('(In reply to Bob at 2026-10-31T09:05:00.000Z: "Restart the box?")');
  });

  it("says what media the quoted message carried, with its caption", () => {
    expect(quotedLine(replyingTo({ photo: [{ file_id: "p" }], caption: "this plant" }))).toBe('(In reply to Bob at 2026-10-31T09:05:00.000Z: "[photo] this plant")');
    expect(quotedLine(replyingTo({ document: { file_id: "d", file_name: "app.log" } }))).toBe('(In reply to Bob at 2026-10-31T09:05:00.000Z: "[file: app.log]")');
    expect(quotedLine(replyingTo({ voice: { file_id: "v", duration: 42 } }))).toBe('(In reply to Bob at 2026-10-31T09:05:00.000Z: "[voice note, 0:42]")');
    expect(quotedLine(replyingTo({ sticker: { file_id: "s" } }))).toBe('(In reply to Bob at 2026-10-31T09:05:00.000Z: "[sticker]")');
  });

  it("puts a long or multi-line quote on one line and trims it to 500 characters", () => {
    const line = quotedLine(replyingTo({ text: `first\nsecond ${"x".repeat(600)}` }));
    expect(line).toMatch(/^\(In reply to Bob at 2026-10-31T09:05:00\.000Z: "first second x+…"\)$/);
    expect(line?.match(/"(.*)"/)?.[1]).toHaveLength(500);
  });

  it("gives no line for a message that is not a reply, or only sits in a forum topic", () => {
    expect(quotedLine({ message_id: 1, chat: { id: 1, type: "private" }, text: "hi" })).toBeUndefined();
    expect(quotedLine(replyingTo({ forum_topic_created: { name: "Deploys" } }))).toBeUndefined();
  });
});
