import type { PluginClientContext } from "@getpaseo/plugin/client";
import { describe, expect, it } from "vitest";
import { crewUpdateData } from "../shared/crew-update.shared";
import { foldCrewUpdates } from "./crew-update-transformer.client";

type Transformer = Parameters<PluginClientContext["addTimelineTransformer"]>[0];

function registeredTransformer(): Transformer {
  let registered: Transformer | undefined;
  foldCrewUpdates({
    addTimelineTransformer: (contribution: Transformer) => {
      registered = contribution;
      return () => {};
    },
  } as unknown as PluginClientContext);
  return registered!;
}

function fold(text: string) {
  const transformer = registeredTransformer();
  expect(transformer.query.itemType).toBe("user_message");
  return (transformer.transform as (input: unknown) => ReturnType<Transformer["transform"]>)({
    item: { type: "user_message", text },
    phase: "complete",
  });
}

const paseoNotification =
  '<paseo-system version="1" kind="agent-message" source-agent-id="69a0ce27" message-id="a897d596" source-agent-title="First mate">\nRead your instructions in /home/paseo/brief.md and follow them.\n</paseo-system>';
const firstmateWatch =
  '<firstmate-watch id="w1" agent="crew-7">crew-7 went idle after 4 minutes.</firstmate-watch>';
const crossDaemon =
  '[cross-daemon abcd1234] Message from agent boss on daemon "mac" (srv_1). Please rebuild the stack.';
const crossDaemonNotice =
  '[cross-daemon notice abcd1234] Agent a1 on daemon "mac" (srv_1) finished the task you sent it.';

describe("fold crew updates", () => {
  it.each([
    ["a Paseo agent notification", paseoNotification, "paseo notification"],
    ["a firstmate watch block", firstmateWatch, "firstmate watch"],
    ["a cross-daemon message", crossDaemon, "cross-daemon message"],
    ["a cross-daemon notice", crossDaemonNotice, "cross-daemon message"],
  ])("replaces %s with one crew-update row holding the full original text", (_name, text, source) => {
    const result = fold(text);
    expect(result?.items).toHaveLength(1);
    const [row] = result!.items;
    expect(row).toMatchObject({ type: "plugin", kind: "crew-update", version: 1 });
    expect(crewUpdateData.parse(row.data)).toEqual({
      source,
      summary: expect.any(String),
      text,
    });
  });

  it("summarises a notification by its content, without the tag attributes", () => {
    const [row] = fold(paseoNotification)!.items;
    expect(row.data).toMatchObject({
      summary: "Read your instructions in /home/paseo/brief.md and follow them.",
    });
  });

  it("keeps the closed summary to one short line", () => {
    const [row] = fold(`<paseo-system>${"long ".repeat(100)}</paseo-system>`)!.items;
    expect((row.data as { summary: string }).summary.length).toBeLessThanOrEqual(80);
  });

  it.each([
    ["a plain message from Max", "Can you fold the crew updates please?"],
    ["a message from Max that mentions a tag", "why does <paseo-system> show up in my chat?"],
    ["a message from Max that mentions cross-daemon", "is the [cross-daemon] plugin installed?"],
    ["an empty message", ""],
  ])("leaves %s untouched", (_name, text) => {
    expect(fold(text)).toBeUndefined();
  });

  it("registers only for user messages, so the reply to Max and every reply stay untouched", () => {
    expect(registeredTransformer().query).toEqual({ itemType: "user_message" });
  });
});
