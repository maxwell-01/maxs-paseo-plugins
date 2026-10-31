import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { BridgeSettings } from "../shared/settings.shared";

const run = promisify(execFile);
// whisper.cpp reads 16 kHz mono WAV; Telegram voice notes are Ogg Opus, which it cannot decode.
const WHISPER_INPUT = ["-ar", "16000", "-ac", "1", "-f", "wav"];
const SILENCE_MARKER = "[BLANK_AUDIO]";
// Telegram's 20 MB limit holds over an hour of speech; small.en takes about 30 s per minute on a Ryzen 5 2600X.
const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

export type VoiceTools = Pick<BridgeSettings, "ffmpegPath" | "whisperCliPath" | "whisperModelPath">;
export type TranscribeVoice = (audio: Buffer, tools: VoiceTools, signal: AbortSignal) => Promise<string>;

const expandHome = (path: string, home: string) => (path.startsWith("~/") ? join(home, path.slice(2)) : path);

export function voiceTools({ ffmpegPath, whisperCliPath, whisperModelPath }: VoiceTools, home: string): VoiceTools {
  return { ffmpegPath: expandHome(ffmpegPath, home), whisperCliPath: expandHome(whisperCliPath, home), whisperModelPath: expandHome(whisperModelPath, home) };
}

async function runTool(path: string, args: string[], signal: AbortSignal): Promise<string> {
  try {
    const { stdout } = await run(path, args, { signal, maxBuffer: OUTPUT_LIMIT_BYTES });
    return stdout;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error(`${basename(path)} is not installed at ${path}`);
    const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const reason = stderr.trim().split("\n").at(-1) || (error instanceof Error ? error.message : String(error));
    throw new Error(`${basename(path)} failed: ${reason}`);
  }
}

export const transcribeVoiceWithin = (timeoutMs: number): TranscribeVoice => async (audio, { ffmpegPath, whisperCliPath, whisperModelPath }, signal) => {
  const dir = await mkdtemp(join(tmpdir(), "telegram-voice-"));
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const voice = join(dir, "voice.ogg");
    const wav = join(dir, "voice.wav");
    await writeFile(voice, audio, { mode: 0o600 });
    await runTool(ffmpegPath, ["-loglevel", "error", "-y", "-i", voice, ...WHISPER_INPUT, wav], deadline);
    const heard = await runTool(whisperCliPath, ["-m", whisperModelPath, "-f", wav, "--no-timestamps", "--no-prints"], deadline);
    const transcript = heard.split("\n").map((line) => line.trim()).filter((line) => line && line !== SILENCE_MARKER).join(" ");
    if (!transcript) throw new Error("whisper heard no speech");
    return transcript;
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw new Error("the transcription took too long and was stopped");
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const transcribeVoice = transcribeVoiceWithin(TRANSCRIBE_TIMEOUT_MS);
