import { describe, expect, it } from "vitest";
import { composeFinishNotice, composeNotDelivered } from "../server/messenger.server";
import { composeMessage } from "../server/tools.server";
import { crossDaemonRowSchema, transformUserMessage } from "./timeline-rows.client";

const own = { name: "tower", serverId: "srv_tower" };
const peer = { name: "mac", serverId: "srv_mac", link: "" };

function rowFor(text: string) {
  const result = transformUserMessage({ item: { type: "user_message", text }, phase: "complete" });
  if (!result) return undefined;
  expect(result.items).toHaveLength(1);
  const [item] = result.items;
  expect(item).toMatchObject({ type: "plugin", kind: "cross-daemon-row", version: 1 });
  return crossDaemonRowSchema.parse((item as { data: unknown }).data);
}

describe("transformUserMessage", () => {
  it("shows a message from an agent as a received row that expands to the sender's text", () => {
    expect(rowFor(composeMessage(own, "1a2b3c4d5e6f", "Run the tests"))).toEqual({
      direction: "received",
      tone: "neutral",
      title: "Message from agent 1a2b3c4d on tower",
      body: "Run the tests",
    });
  });

  it("names a message from a user or script", () => {
    expect(rowFor(composeMessage(own, null, "hi"))?.title).toBe("Message from a user or script on tower");
  });

  it("shows a finish notice with the last message as its body", () => {
    expect(rowFor(composeFinishNotice(peer, "9f8e7d6c5b4a", "Done."))).toEqual({
      direction: "received",
      tone: "neutral",
      title: "Agent 9f8e7d6c on mac finished",
      body: "Done.",
    });
  });

  it("shows a not-delivered notice as a danger row with the reason always visible", () => {
    expect(rowFor(composeNotDelivered("1a2b3c4d5e6f", "mac", "the agent is archived"))).toEqual({
      direction: "received",
      tone: "danger",
      title: "Message to agent 1a2b3c4d on mac not delivered",
      detail: "the agent is archived",
    });
  });

  it("leaves an ordinary user message alone", () => {
    expect(rowFor("fix the bug please")).toBeUndefined();
  });
});
