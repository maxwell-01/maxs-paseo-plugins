import { describe, expect, it } from "vitest";
import { isTeamAgent, lastSaid, needsYou } from "./live-agents.server";

describe("lastSaid", () => {
  it("joins the assistant messages that close the timeline, past any notice", () => {
    expect(lastSaid([
      { type: "assistant_message", text: "earlier" },
      { type: "tool_call" },
      { type: "assistant_message", text: "Added a guard. " },
      { type: "assistant_message", text: "Running checks." },
      { type: "notification" },
    ])).toBe("Added a guard. Running checks.");
  });

  it("is null when the turn did not close with words", () => {
    expect(lastSaid([{ type: "assistant_message", text: "hi" }, { type: "user_message", text: "go" }])).toBeNull();
  });
});

describe("isTeamAgent", () => {
  it("keeps an agent with any label under a team prefix", () => {
    expect(isTeamAgent({ "ticket-loop.run": "r" }, ["ticket-loop."])).toBe(true);
    expect(isTeamAgent({ "ticket-loopy": "r", other: "x" }, ["ticket-loop."])).toBe(false);
  });
});

describe("needsYou", () => {
  it("counts a permission or an error, not a finished turn", () => {
    expect(needsYou({ requiresAttention: true, attentionReason: "permission" })).toBe(true);
    expect(needsYou({ requiresAttention: true, attentionReason: "error" })).toBe(true);
    expect(needsYou({ requiresAttention: true, attentionReason: "finished" })).toBe(false);
    expect(needsYou({ requiresAttention: false })).toBe(false);
  });
});
