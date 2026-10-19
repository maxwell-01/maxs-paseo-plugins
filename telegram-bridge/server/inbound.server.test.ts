import { describe, expect, it } from "vitest";
import { paseoMessageId, promptFor } from "./inbound.server";
import type { TelegramMessage } from "./telegram-api.server";

const message = (fields: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 17,
  chat: { id: -100200, type: "supergroup" },
  from: { id: 1, first_name: "Max" },
  ...fields,
});

describe("inbound formatting", () => {
  it("names Telegram and the sender, and says where the reply goes", () => {
    expect(promptFor(message({ text: "Is the deploy done?" }))).toBe(
      "[Telegram, Max]: Is the deploy done?\n(Your reply goes back to this Telegram chat.)",
    );
  });

  it("has no prompt for a message without text, such as a sticker", () => {
    expect(promptFor(message({}))).toBeNull();
  });

  it("gives each chat's message its own Paseo message id", () => {
    expect(paseoMessageId(message({}))).toBe("telegram--100200-17");
  });
});
