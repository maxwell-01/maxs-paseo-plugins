import type { TelegramMessage } from "./telegram-api.server";

export const UNSUPPORTED_REPLY = "Only text messages reach the agent.";

const UNSUPPORTED_CONTENT_KINDS = ["animation", "audio", "contact", "dice", "document", "location", "photo", "poll", "sticker", "venue", "video", "video_note", "voice"];

export const isUnsupportedContent = (message: TelegramMessage) => UNSUPPORTED_CONTENT_KINDS.some((kind) => kind in message);

export const paseoMessageId = (message: TelegramMessage) => `telegram-${message.chat.id}-${message.message_id}`;

export function promptFor(message: TelegramMessage): string | null {
  if (message.text === undefined) return null;
  const sender = message.from?.first_name ?? "unknown";
  return `[Telegram, ${sender}]: ${message.text}\n(Your reply goes back to this Telegram chat.)`;
}
