import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEPT_MESSAGES = 300;

function readLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export const withAttached = (text: string, names: string[]) => (names.length > 0 ? `${text} [attached: ${names.join(", ")}]`.trim() : text);

// The Bot API cannot fetch a chat's past messages, so the bridge keeps the recent ones for the agent to read.
export function createChatHistory(dir: string, now = () => new Date()) {
  const fileFor = (chatId: number) => join(dir, `${chatId}.log`);
  return {
    fileFor,
    record(chatId: number, who: string, text: string): void {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = fileFor(chatId);
      const entry = `${now().toISOString()} ${who}: ${text.replaceAll("\n", " ⏎ ")}`;
      writeFileSync(file, `${[...readLines(file), entry].slice(-KEPT_MESSAGES).join("\n")}\n`, { mode: 0o600 });
    },
  };
}
export type ChatHistory = ReturnType<typeof createChatHistory>;
