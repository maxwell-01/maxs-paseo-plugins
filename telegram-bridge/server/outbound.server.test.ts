import { describe, expect, it } from "vitest";
import { finalReplyText, NO_TEXT_REPLY, replyFor, splitForTelegram, type Timeline } from "./outbound.server";

const user = (text: string) => ({ type: "user_message" as const, text });
const said = (text: string) => ({ type: "assistant_message" as const, text });
const tool = { type: "tool_call" as const, callId: "1", name: "Bash", detail: { type: "unknown" as const, input: null, output: null }, status: "completed" as const, error: null };

describe("final reply text", () => {
  it("is the text after the agent's last tool call in the latest turn, joined across chunks", () => {
    const timeline: Timeline = [user("old"), said("old answer"), user("status?"), said("Checking."), tool, said("All "), said("green.")];
    expect(finalReplyText(timeline)).toBe("All green.");
  });

  it("falls back to the turn's last text when the turn ends on a tool call", () => {
    expect(finalReplyText([user("save it"), said("Saved to notes."), tool])).toBe("Saved to notes.");
  });

  it("says so when the turn has no text at all", () => {
    expect(finalReplyText([said("old answer"), user("run it"), tool])).toBe(NO_TEXT_REPLY);
  });

  it("reports a failed or canceled turn instead of its text", () => {
    expect(replyFor({ kind: "failed", error: { message: "rate limited" } }, [])).toBe("The agent's turn failed: rate limited");
    expect(replyFor({ kind: "canceled", reason: "interrupted" }, [])).toBe("The agent's turn was canceled before it replied.");
  });
});

describe("splitting for Telegram's 4096-character limit", () => {
  it("keeps a short reply whole", () => {
    expect(splitForTelegram("hello")).toEqual(["hello"]);
  });

  it("breaks at the last line break that fits, dropping it", () => {
    expect(splitForTelegram("aaaa\nbbb\ncc", 9)).toEqual(["aaaa\nbbb", "cc"]);
  });

  it("breaks at a space when a line is too long", () => {
    expect(splitForTelegram("aaa bbb ccc", 8)).toEqual(["aaa bbb", "ccc"]);
  });

  it("cuts a long word hard, but never inside a surrogate pair", () => {
    expect(splitForTelegram("abc😀def", 4)).toEqual(["abc", "😀de", "f"]);
  });

  it("sends no empty part when the cut falls on the last character", () => {
    expect(splitForTelegram("aaaa\n", 4)).toEqual(["aaaa"]);
  });

  it("makes every chunk of a real-size reply fit", () => {
    const chunks = splitForTelegram("word ".repeat(2000));
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });
});
