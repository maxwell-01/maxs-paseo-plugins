import type { Attachments } from "./attachments.server";
import type { TelegramMessage } from "./telegram-api.server";

export const UNSUPPORTED_REPLY = "Only text, photos and files reach the agent.";
export const REPLY_HINT = "(Your reply goes back to this Telegram chat. To send a file back, put a line [[send: /absolute/path]] in your reply.)";

const UNSUPPORTED_CONTENT_KINDS = ["animation", "audio", "contact", "dice", "location", "poll", "sticker", "venue", "video", "video_note", "voice"];

export const isUnsupportedContent = (message: TelegramMessage) => UNSUPPORTED_CONTENT_KINDS.some((kind) => kind in message);

export const hasContentForAgent = (message: TelegramMessage) => message.text !== undefined || message.photo !== undefined || message.document !== undefined;

export const paseoMessageId = (message: TelegramMessage) => `telegram-${message.chat.id}-${message.message_id}`;

function describeContent(message: TelegramMessage): string {
  if (message.text !== undefined) return message.text;
  if (message.caption !== undefined) return message.caption;
  return message.photo ? "(sent a photo)" : "(sent a file)";
}

export function promptFor(message: TelegramMessage, { savedFiles, notes }: Attachments): string {
  const sender = message.from?.first_name ?? "unknown";
  return [
    `[Telegram, ${sender}]: ${describeContent(message)}`,
    ...savedFiles.map(({ path, mimeType }) => `Attached file: ${path} (${mimeType})`),
    ...notes.map((note) => `(${note})`),
    REPLY_HINT,
  ].join("\n");
}
