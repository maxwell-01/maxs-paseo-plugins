import type { BridgeSettings } from "../shared/settings.shared";
import type { TelegramMessage } from "./telegram-api.server";

type AllowList = Pick<BridgeSettings, "allowedUserIds" | "allowedChatIds">;

// Telegram never returns the bot's own messages to getUpdates, and no bot is on the user list, so nothing loops.
export function isAllowed(message: TelegramMessage, { allowedUserIds, allowedChatIds }: AllowList): boolean {
  return message.from !== undefined && allowedUserIds.includes(message.from.id) && allowedChatIds.includes(message.chat.id);
}

export function createIgnoredSenderLog(log: (line: string) => void) {
  const seen = new Set<string>();
  return (message: TelegramMessage) => {
    const key = `${message.from?.id}:${message.chat.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const chat = message.chat.title ? ` (${message.chat.title})` : "";
    log(`telegram-bridge: ignored a message from user ${message.from?.id ?? "unknown"} in chat ${message.chat.id}${chat}; add both ids to the settings to allow it`);
  };
}
