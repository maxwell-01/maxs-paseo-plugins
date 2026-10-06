import { describe, expect, it } from "vitest";
import { lastSaid } from "./live-agents.server";

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
