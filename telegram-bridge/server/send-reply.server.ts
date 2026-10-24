import { describeError } from "./describe-error.server";
import { splitForTelegram } from "./outbound.server";
import type { FileToSend } from "./send-files.server";
import { type TelegramApi, TelegramApiError } from "./telegram-api.server";

const BAD_REQUEST = 400;

async function sendFile(api: TelegramApi, chatId: number, { kind, path }: FileToSend, replyTo: number | undefined) {
  if (kind === "photo") {
    try {
      return await api.sendFile(chatId, "photo", path, replyTo);
    } catch (error) {
      if (!(error instanceof TelegramApiError && error.status === BAD_REQUEST)) throw error;
    }
  }
  await api.sendFile(chatId, "document", path, replyTo);
}

export async function sendReply(api: TelegramApi, { chatId, replyTo }: { chatId: number; replyTo?: number }, { body, files }: { body: string; files: FileToSend[] }) {
  let threadTo: number | undefined = replyTo;
  for (const chunk of splitForTelegram(body)) {
    await api.sendMessage(chatId, chunk, threadTo);
    threadTo = undefined;
  }
  const failures: string[] = [];
  for (const file of files) {
    try {
      await sendFile(api, chatId, file, threadTo);
      threadTo = undefined;
    } catch (error) {
      failures.push(`Could not send ${file.path}: ${describeError(error)}`);
    }
  }
  if (failures.length > 0) await api.sendMessage(chatId, failures.join("\n\n"), threadTo);
}
