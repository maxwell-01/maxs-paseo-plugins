import { UNSUPPORTED_CONTENT_KINDS } from "./content-kinds.server";
import type { TelegramMessage } from "./telegram-api.server";
import { minutesAndSeconds } from "./voice-note.server";

type QuotedMessage = NonNullable<TelegramMessage["reply_to_message"]>;

const QUOTE_LIMIT = 500;
const SERVICE_MESSAGE_LABEL = "[message]";
// In a forum supergroup every message replies to its topic's first message, which is not a reply the sender chose.
const TOPIC_START_KIND = "forum_topic_created";

function mediaLabel(quoted: QuotedMessage): string | undefined {
  if (quoted.photo) return "[photo]";
  if (quoted.document) return `[file: ${quoted.document.file_name ?? "file"}]`;
  if (quoted.voice) return `[voice note, ${minutesAndSeconds(quoted.voice.duration)}]`;
  const kind = UNSUPPORTED_CONTENT_KINDS.find((candidate) => candidate in quoted);
  return kind && `[${kind.replace("_", " ")}]`;
}

function trimmed(text: string): string {
  const codePoints = Array.from(text);
  return codePoints.length > QUOTE_LIMIT ? `${codePoints.slice(0, QUOTE_LIMIT - 1).join("")}…` : text;
}

export function quotedLine({ reply_to_message: quoted }: TelegramMessage): string | undefined {
  if (!quoted || TOPIC_START_KIND in quoted) return undefined;
  const content = [mediaLabel(quoted), quoted.text ?? quoted.caption].filter((part) => part !== undefined).join(" ").replace(/\s+/g, " ").trim();
  const sender = quoted.from?.first_name ?? "unknown";
  const sentAt = new Date(quoted.date * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `(In reply to ${sender} at ${sentAt}: "${trimmed(content) || SERVICE_MESSAGE_LABEL}")`;
}
