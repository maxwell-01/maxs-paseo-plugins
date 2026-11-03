import type { TelegramMessage } from "./telegram-api.server";

export const UNSUPPORTED_CONTENT_KINDS = ["animation", "audio", "contact", "dice", "location", "poll", "sticker", "venue", "video", "video_note"];

export const isUnsupportedContent = (message: TelegramMessage) => UNSUPPORTED_CONTENT_KINDS.some((kind) => kind in message);
