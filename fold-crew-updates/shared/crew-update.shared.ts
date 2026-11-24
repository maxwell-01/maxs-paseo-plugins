import { z } from "zod";

export const crewUpdateKind = "crew-update";

export const crewUpdateData = z.object({
  source: z.enum(["paseo notification", "firstmate watch", "cross-daemon message"]),
  summary: z.string(),
  text: z.string(),
});
export type CrewUpdateData = z.output<typeof crewUpdateData>;

const SUMMARY_LENGTH = 80;

const sources: { source: CrewUpdateData["source"]; startsWith: RegExp }[] = [
  { source: "paseo notification", startsWith: /^<paseo-system[\s>]/ },
  { source: "firstmate watch", startsWith: /^<firstmate-watch[\s>]/ },
  { source: "cross-daemon message", startsWith: /^\[cross-daemon[\s\]]/ },
];

function summaryOf(text: string): string {
  const withoutTags = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const line = withoutTags || text.replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1)}…` : line;
}

export function classifyCrewUpdate(text: string): CrewUpdateData | undefined {
  const trimmed = text.trimStart();
  const match = sources.find(({ startsWith }) => startsWith.test(trimmed));
  if (!match) return undefined;
  return { source: match.source, summary: summaryOf(trimmed), text };
}
