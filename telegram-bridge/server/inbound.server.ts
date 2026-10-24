import type { Attachments } from "./attachments.server";
import { withAttached } from "./chat-history.server";
import type { TelegramMessage } from "./telegram-api.server";

export const UNSUPPORTED_REPLY = "Only text, photos and files reach the agent.";
export const replyHint = (chatId: number, historyFile: string) =>
  `(Your reply goes back to this Telegram chat. To send a file back, put a line [[send: /absolute/path]] in your reply. To message this chat later, from a turn that did not start here, put a line [[telegram: ${chatId}]] in that turn's final reply. This chat's recent messages, yours included, are in ${historyFile}; read it when you need context, and before a follow-up.)`;

const UNSUPPORTED_CONTENT_KINDS = ["animation", "audio", "contact", "dice", "location", "poll", "sticker", "venue", "video", "video_note", "voice"];

export const isUnsupportedContent = (message: TelegramMessage) => UNSUPPORTED_CONTENT_KINDS.some((kind) => kind in message);

export const hasContentForAgent = (message: TelegramMessage) => message.text !== undefined || message.photo !== undefined || message.document !== undefined;

export const paseoMessageId = (message: TelegramMessage) => `telegram-${message.chat.id}-${message.message_id}`;

function describeContent(message: TelegramMessage): string {
  if (message.text !== undefined) return message.text;
  if (message.caption !== undefined) return message.caption;
  return message.photo ? "(sent a photo)" : "(sent a file)";
}

const chatName = ({ chat }: TelegramMessage) => (chat.type === "private" ? "direct chat" : (chat.title ?? `chat ${chat.id}`));

const senderName = (message: TelegramMessage) => message.from?.first_name ?? "unknown";

export function historyEntryFor(message: TelegramMessage): { who: string; text: string } {
  const attached = [...(message.photo ? ["photo"] : []), ...(message.document ? [message.document.file_name ?? "file"] : [])];
  return { who: `${senderName(message)} in ${chatName(message)}`, text: withAttached(describeContent(message), attached) };
}

export function promptFor(message: TelegramMessage, { savedFiles, notes }: Attachments, historyFile: string): string {
  return [
    `[Telegram, ${senderName(message)}, in ${chatName(message)}]: ${describeContent(message)}`,
    ...savedFiles.map(({ path, mimeType }) => `Attached file: ${path} (${mimeType})`),
    ...notes.map((note) => `(${note})`),
    replyHint(message.chat.id, historyFile),
  ].join("\n");
}
