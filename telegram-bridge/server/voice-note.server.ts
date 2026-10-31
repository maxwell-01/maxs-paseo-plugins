import { downloadWithinLimit } from "./attachments.server";
import { describeError } from "./describe-error.server";
import type { TelegramApi, TelegramMessage } from "./telegram-api.server";
import type { TranscribeVoice, VoiceTools } from "./transcriber.server";

type Voice = NonNullable<TelegramMessage["voice"]>;
type VoiceNoteText = { ok: true; text: string } | { ok: false; reason: string };

const minutesAndSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export async function voiceNoteText(api: Pick<TelegramApi, "download">, voice: Voice, transcribe: TranscribeVoice, tools: VoiceTools, signal: AbortSignal): Promise<VoiceNoteText> {
  const audio = await downloadWithinLimit(api, "The voice note", voice.file_id, voice.file_size, signal);
  if (!audio.ok) return { ok: false, reason: audio.note };
  try {
    return { ok: true, text: `[voice note, ${minutesAndSeconds(voice.duration)}] ${await transcribe(audio.bytes, tools, signal)}` };
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, reason: describeError(error) };
  }
}
