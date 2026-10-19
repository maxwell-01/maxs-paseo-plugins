import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeError } from "./describe-error.server";
import type { TelegramApi, TelegramMessage } from "./telegram-api.server";

const BOT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const TELEGRAM_PHOTO_TYPE = "image/jpeg";

export interface Attachments {
  images: Array<{ data: string; mimeType: string }>;
  savedFiles: Array<{ path: string; mimeType: string }>;
  notes: string[];
}

type Download = { ok: true; bytes: Buffer } | { ok: false; note: string };

const safeFileName = (name: string) => name.replace(/[^\w.-]/g, "_").replace(/^\.+/, "") || "file";

async function downloadWithinLimit(api: Pick<TelegramApi, "download">, label: string, fileId: string, size: number | undefined, signal: AbortSignal): Promise<Download> {
  if (size !== undefined && size > BOT_DOWNLOAD_LIMIT_BYTES) return { ok: false, note: `${label} is over Telegram's 20 MB bot download limit, so it was not fetched.` };
  try {
    return { ok: true, bytes: await api.download(fileId, signal) };
  } catch (error) {
    return { ok: false, note: `${label} could not be fetched: ${describeError(error)}` };
  }
}

async function save(bytes: Buffer, message: TelegramMessage, name: string, filesDir: string): Promise<string> {
  const chatDir = join(filesDir, String(message.chat.id));
  await mkdir(chatDir, { recursive: true, mode: 0o700 });
  const path = join(chatDir, `${message.message_id}-${safeFileName(name)}`);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

export async function fetchAttachments(api: Pick<TelegramApi, "download">, message: TelegramMessage, filesDir: string, signal: AbortSignal): Promise<Attachments> {
  const attachments: Attachments = { images: [], savedFiles: [], notes: [] };
  const largestPhoto = message.photo?.at(-1);
  if (largestPhoto) {
    const photo = await downloadWithinLimit(api, "The photo", largestPhoto.file_id, largestPhoto.file_size, signal);
    if (photo.ok) attachments.images.push({ data: photo.bytes.toString("base64"), mimeType: TELEGRAM_PHOTO_TYPE });
    else attachments.notes.push(photo.note);
  }
  const { document } = message;
  if (document) {
    const name = document.file_name ?? "file";
    const file = await downloadWithinLimit(api, name, document.file_id, document.file_size, signal);
    if (!file.ok) attachments.notes.push(file.note);
    else {
      try {
        attachments.savedFiles.push({ path: await save(file.bytes, message, name, filesDir), mimeType: document.mime_type ?? "application/octet-stream" });
      } catch (error) {
        attachments.notes.push(`${name} could not be saved: ${describeError(error)}`);
      }
    }
  }
  return attachments;
}
