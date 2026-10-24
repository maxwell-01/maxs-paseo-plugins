const CODE_FENCE = /^\s*```/;

// A marker inside a code block is left as text, so the agent can show one without acting on it.
export function takeMarkedLines(reply: string, marker: RegExp): { text: string; values: string[] } {
  const values: string[] = [];
  let inCodeBlock = false;
  const kept = reply.split("\n").filter((line) => {
    if (CODE_FENCE.test(line)) inCodeBlock = !inCodeBlock;
    const value = inCodeBlock ? undefined : marker.exec(line)?.[1];
    if (value !== undefined) values.push(value);
    return value === undefined;
  });
  return { text: kept.join("\n").trim(), values };
}
