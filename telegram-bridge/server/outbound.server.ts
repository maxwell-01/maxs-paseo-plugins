import type { PluginLifecycleEvents, PluginTurnOutcome } from "@getpaseo/plugin/server";

export type Timeline = PluginLifecycleEvents["agent.turn_ended"]["timeline"];

const TELEGRAM_TEXT_LIMIT = 4096;
export const NO_TEXT_REPLY = "(The agent finished without a text reply.)";

function assistantText(items: Timeline): string {
  return items.flatMap((item) => (item.type === "assistant_message" ? [item.text] : [])).join("");
}

export function finalReplyText(timeline: Timeline): string {
  const turn = timeline.slice(timeline.findLastIndex((item) => item.type === "user_message") + 1);
  const narrationEnd = turn.findLastIndex((item) => item.type === "tool_call") + 1;
  const answer = assistantText(turn.slice(narrationEnd));
  if (answer.trim()) return answer;
  const lastMessage = turn.findLast((item) => item.type === "assistant_message");
  return lastMessage?.text.trim() ? lastMessage.text : NO_TEXT_REPLY;
}

export function replyFor(outcome: PluginTurnOutcome, timeline: Timeline): string {
  if (outcome.kind === "failed") return `The agent's turn failed: ${outcome.error.message}`;
  if (outcome.kind === "canceled") return "The agent's turn was canceled before it replied.";
  return finalReplyText(timeline);
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

function cutPoint(text: string, limit: number): { end: number; skip: number } {
  for (const separator of ["\n", " "]) {
    const at = text.lastIndexOf(separator, limit);
    if (at > 0) return { end: at, skip: 1 };
  }
  return { end: isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit, skip: 0 };
}

export function splitForTelegram(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const { end, skip } = cutPoint(rest, limit);
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end + skip);
  }
  return [...chunks, rest].filter((chunk) => chunk.trim() !== "");
}
