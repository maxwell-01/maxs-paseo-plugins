import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { describe, expect, it } from "vitest";
import { composeFinishNotice, composeNotDelivered } from "../server/messenger.server";
import { composeMessage } from "../server/tools.server";
import { crossDaemonRowSchema, transformToolCall, transformUserMessage } from "./timeline-rows.client";

const own = { name: "tower", serverId: "srv_tower" };
const peer = { name: "mac", serverId: "srv_mac", link: "" };

function rowFor(text: string) {
  const result = transformUserMessage({ item: { type: "user_message", text }, phase: "complete" });
  if (!result) return undefined;
  expect(result.items).toHaveLength(1);
  const [item] = result.items;
  expect(item).toMatchObject({ type: "plugin", kind: "cross-daemon-row", version: 1 });
  return crossDaemonRowSchema.parse(item.data);
}

describe("transformUserMessage", () => {
  it("shows a message from an agent as a received row that expands to the sender's text", () => {
    expect(rowFor(composeMessage(own, "1a2b3c4d5e6f", "Run the tests"))).toStrictEqual({
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
    expect(rowFor(composeFinishNotice(peer, "9f8e7d6c5b4a", "Done."))).toStrictEqual({
      direction: "received",
      tone: "neutral",
      title: "Agent 9f8e7d6c on mac finished",
      body: "Done.",
    });
  });

  it("shows a not-delivered notice as a danger row with the reason always visible", () => {
    expect(rowFor(composeNotDelivered("1a2b3c4d5e6f", "mac", "the agent is archived"))).toStrictEqual({
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

type ToolCallItem = Parameters<PluginTimelineTransformerContribution<"tool_call">["transform"]>[0]["item"];
type CallState = { status: "running" | "completed" | "canceled" } | { status: "failed"; error: unknown };

function toolCall(name: string, state: CallState, input: unknown, output: unknown): ToolCallItem {
  const base = { type: "tool_call" as const, callId: "c1", name, detail: { type: "unknown" as const, input, output } };
  return state.status === "failed" ? { ...base, status: "failed", error: state.error } : { ...base, status: state.status, error: null };
}

function callRow(name: string, state: CallState, input: unknown, output: unknown = null) {
  const result = transformToolCall({ item: toolCall(name, state, input, output), phase: "complete" });
  if (!result) return undefined;
  expect(result.items).toHaveLength(1);
  const [row] = result.items;
  expect(row).toMatchObject({ type: "plugin", kind: "cross-daemon-row", version: 1 });
  return crossDaemonRowSchema.parse(row.data);
}

describe("transformToolCall", () => {
  const send = { daemon: "tower", agentId: "1a2b3c4d5e6f", prompt: "Run the tests" };

  it("shows a completed Claude send as a sent row with the prompt as its body", () => {
    expect(callRow("mcp__cross-daemon__send_agent_prompt", { status: "completed" }, send, { output: "Sent to agent 1a2b3c4d5e6f." })).toStrictEqual({
      direction: "sent",
      tone: "neutral",
      title: "Message to agent 1a2b3c4d on tower",
      detail: "Sent to agent 1a2b3c4d5e6f.",
      body: "Run the tests",
    });
  });

  it("shows a completed Codex create with its working directory and result text", () => {
    const output = { content: [{ type: "text", text: "Started agent abc." }] };
    expect(callRow("cross-daemon.create_agent", { status: "completed" }, { daemon: "tower", cwd: "/work/app", prompt: "Go" }, output)).toStrictEqual({
      direction: "sent",
      tone: "neutral",
      title: "Start an agent on tower in /work/app",
      detail: "Started agent abc.",
      body: "Go",
    });
  });

  it("uses a generic title and a running detail while the input has not streamed in", () => {
    expect(callRow("mcp__cross-daemon__send_agent_prompt", { status: "running" }, null)).toStrictEqual({
      direction: "sent",
      tone: "running",
      title: "Message to an agent on another daemon",
      detail: "Sending…",
    });
  });

  it("uses the generic title when streamed input lacks a field the title needs", () => {
    expect(callRow("mcp__cross-daemon__archive_agent", { status: "running" }, { daemon: "tower" })?.title).toBe("Archive an agent on another daemon");
    expect(callRow("cross-daemon.create_agent", { status: "running" }, { daemon: "tower" })?.title).toBe("Start an agent on another daemon");
  });

  it("gives archive no body", () => {
    expect(callRow("mcp__cross-daemon__archive_agent", { status: "completed" }, { daemon: "tower", agentId: "1a2b3c4d5e6f" }, { output: "Archived." })).toStrictEqual({
      direction: "sent",
      tone: "neutral",
      title: "Archive agent 1a2b3c4d on tower",
      detail: "Archived.",
    });
  });

  it("shows a failed call in danger tone with a string error", () => {
    const row = callRow("mcp__cross-daemon__send_agent_prompt", { status: "failed", error: { content: "Could not reach tower" } }, send, null);
    expect(row).toMatchObject({ tone: "danger", detail: "Could not reach tower" });
  });

  it("joins the texts of an array error", () => {
    const error = { content: [{ type: "text", text: "Could not" }, { type: "text", text: "reach tower" }] };
    expect(callRow("mcp__cross-daemon__send_agent_prompt", { status: "failed", error }, send, null)?.detail).toBe("Could not\nreach tower");
  });

  it("reads a Codex failure from the output when error is null", () => {
    const output = { content: [{ type: "text", text: "Unknown daemon" }] };
    expect(callRow("cross-daemon.send_agent_prompt", { status: "failed", error: null }, send, output)).toMatchObject({ tone: "danger", detail: "Unknown daemon" });
  });

  it("says Failed when a failed call carries no text", () => {
    expect(callRow("cross-daemon.send_agent_prompt", { status: "failed", error: null }, send)).toMatchObject({ tone: "danger", detail: "Failed" });
  });

  it("shows a canceled call in warning tone", () => {
    expect(callRow("cross-daemon.archive_agent", { status: "canceled" }, null)).toMatchObject({ tone: "warning", detail: "Canceled" });
  });

  it("leaves other tools alone", () => {
    expect(callRow("mcp__cross-daemon__list_agents", { status: "completed" }, {})).toBeUndefined();
    expect(callRow("mcp__paseo__send_agent_prompt", { status: "completed" }, send)).toBeUndefined();
    expect(callRow("Bash", { status: "completed" }, { command: "ls" })).toBeUndefined();
  });
});
