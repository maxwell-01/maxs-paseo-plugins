import { takeMarkedLines } from "./marked-lines.server";

const FOLLOW_UP_LINE = /^\s*\[\[telegram:\s*(-?\d+)\s*\]\]\s*$/;

export function takeFollowUpChats(reply: string): { text: string; chatIds: number[] } {
  const { text, values } = takeMarkedLines(reply, FOLLOW_UP_LINE);
  return { text, chatIds: [...new Set(values.map(Number))] };
}
