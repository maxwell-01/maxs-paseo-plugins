import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeSettings } from "../shared/settings.shared";
import { transcribeVoice, type VoiceTools, voiceTools } from "./transcriber.server";
import { makeTempDir } from "./temp-dir.test-support";

const never = new AbortController().signal;

function fakeTools(whisperScript: string): VoiceTools {
  const dir = makeTempDir("tg-tools-");
  const script = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  };
  // The fake ffmpeg copies its input (after -i) to its output (the last argument).
  const ffmpegPath = script("ffmpeg", 'in=""; while [ $# -gt 1 ]; do [ "$1" = "-i" ] && in="$2"; shift; done; cp "$in" "$1"');
  return { ffmpegPath, whisperCliPath: script("whisper-cli", whisperScript), whisperModelPath: join(dir, "model.bin") };
}

describe("transcribing a voice note", () => {
  it("converts the audio and returns what whisper heard, on one line", async () => {
    const tools = fakeTools('while [ "$1" != "-f" ]; do shift; done; cat "$2"; printf "\\n and more.\\n"');
    expect(await transcribeVoice(Buffer.from(" Hello there."), tools, never)).toBe("Hello there. and more.");
  });

  it("passes the model to whisper", async () => {
    const tools = fakeTools('echo "$@"');
    expect(await transcribeVoice(Buffer.from("x"), tools, never)).toContain(`-m ${tools.whisperModelPath}`);
  });

  it("fails with whisper's last error line when it exits with an error", async () => {
    const tools = fakeTools('echo "loading" >&2; echo "error: failed to load model" >&2; exit 1');
    await expect(transcribeVoice(Buffer.from("x"), tools, never)).rejects.toThrow("whisper-cli failed: error: failed to load model");
  });

  it("fails when it hears no speech", async () => {
    await expect(transcribeVoice(Buffer.from("x"), fakeTools('echo " [BLANK_AUDIO]"'), never)).rejects.toThrow("heard no speech");
  });

  it("fails plainly when a tool is not installed", async () => {
    const tools = { ...fakeTools("true"), ffmpegPath: "/nowhere/ffmpeg" };
    await expect(transcribeVoice(Buffer.from("x"), tools, never)).rejects.toThrow("/nowhere/ffmpeg");
  });

  const installed = voiceTools(bridgeSettings.schema.parse({}), homedir());
  it.skipIf(!Object.values(installed).every((path) => existsSync(path)))("transcribes real speech with the tools installed on this host", async () => {
    const audio = readFileSync(join(import.meta.dirname, "fixtures", "ask-not.ogg"));
    expect(await transcribeVoice(audio, installed, never)).toMatch(/ask not what your country can do for you/i);
  }, 120_000);
});

describe("the tools' paths", () => {
  it("expands ~/ to the daemon user's home and keeps absolute paths", () => {
    expect(voiceTools({ ffmpegPath: "/usr/bin/ffmpeg", whisperCliPath: "~/.local/bin/whisper-cli", whisperModelPath: "~/m.bin" }, "/home/paseo")).toEqual({
      ffmpegPath: "/usr/bin/ffmpeg",
      whisperCliPath: "/home/paseo/.local/bin/whisper-cli",
      whisperModelPath: "/home/paseo/m.bin",
    });
  });
});
