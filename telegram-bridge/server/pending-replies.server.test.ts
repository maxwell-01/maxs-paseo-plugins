import { describe, expect, it } from "vitest";
import { createPendingReplies } from "./pending-replies.server";

const sent = (messageId: string) => ({ type: "user_message" as const, text: "", messageId });
const typedInApp = { type: "user_message" as const, text: "from the app", messageId: "app-1" };

describe("pending replies", () => {
  it("answers the chat whose message the turn took in, once", () => {
    const pending = createPendingReplies();
    pending.add("telegram-1-5", { chatId: 1, replyTo: 5 });
    expect(pending.takeAnsweredBy([sent("telegram-1-5")])).toEqual([{ chatId: 1, replyTo: 5 }]);
    expect(pending.takeAnsweredBy([sent("telegram-1-5")])).toEqual([]);
  });

  it("answers nothing for a turn started from the app", () => {
    const pending = createPendingReplies();
    pending.add("telegram-1-5", { chatId: 1, replyTo: 5 });
    expect(pending.takeAnsweredBy([typedInApp])).toEqual([]);
    expect(pending.takeAnsweredBy([typedInApp, sent("telegram-1-5")])).toEqual([{ chatId: 1, replyTo: 5 }]);
  });

  it("sends one reply per chat, to its newest message, when a turn took in several", () => {
    const pending = createPendingReplies();
    pending.add("telegram-1-5", { chatId: 1, replyTo: 5 });
    pending.add("telegram-1-6", { chatId: 1, replyTo: 6 });
    pending.add("telegram-2-3", { chatId: 2, replyTo: 3 });
    expect(pending.takeAnsweredBy([sent("telegram-1-5"), sent("telegram-2-3"), sent("telegram-1-6")])).toEqual([
      { chatId: 1, replyTo: 6 },
      { chatId: 2, replyTo: 3 },
    ]);
  });
});
