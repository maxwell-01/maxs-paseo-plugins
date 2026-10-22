import { describe, expect, it } from "vitest";
import { createIgnoredSenderLog, isAllowed } from "./allow-list.server";
import type { TelegramMessage } from "./telegram-api.server";

const MAX = 111;
const GROUP = -100200;
const lists = { allowedUserIds: [MAX], allowedChatIds: [GROUP] };
const message = (userId: number | undefined, chatId: number): TelegramMessage => ({
  message_id: 1,
  chat: { id: chatId, type: "supergroup", title: "Crew" },
  from: userId === undefined ? undefined : { id: userId, first_name: "Someone" },
  text: "secret plans",
});

describe("allow-list", () => {
  it("lets an allowed user in an allowed chat through", () => {
    expect(isAllowed(message(MAX, GROUP), lists)).toBe(true);
  });

  it.each([
    ["a stranger in the allowed chat", message(222, GROUP)],
    ["the allowed user in another chat", message(MAX, -999)],
    ["a message with no sender, such as a channel post", message(undefined, GROUP)],
  ])("ignores %s", (_case, ignored) => {
    expect(isAllowed(ignored, lists)).toBe(false);
  });

  it("ignores everyone while the lists are empty", () => {
    expect(isAllowed(message(MAX, GROUP), { allowedUserIds: [], allowedChatIds: [] })).toBe(false);
  });

  it("logs each ignored user and chat once, with ids but never the text", () => {
    const lines: string[] = [];
    const logIgnored = createIgnoredSenderLog((line) => lines.push(line));
    logIgnored(message(222, GROUP));
    logIgnored(message(222, GROUP));
    logIgnored(message(333, GROUP));
    expect(lines).toEqual([
      "telegram-bridge: ignored a message from user 222 in chat -100200 (Crew); add both ids to the settings to allow it",
      "telegram-bridge: ignored a message from user 333 in chat -100200 (Crew); add both ids to the settings to allow it",
    ]);
  });
});
