import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const bridgeSettings = defineSettings({
  id: "bridge",
  scope: "host",
  version: 1,
  schema: z.object({
    botToken: z.string().default(""),
    agentId: z.string().default(""),
    allowedUserIds: z.array(z.number().int()).default([]),
    allowedChatIds: z.array(z.number().int()).default([]),
    ffmpegPath: z.string().default("~/.local/bin/ffmpeg"),
    whisperCliPath: z.string().default("~/.local/bin/whisper-cli"),
    whisperModelPath: z.string().default("~/.local/share/whisper/ggml-small.en.bin"),
  }),
});

export type BridgeSettings = z.output<typeof bridgeSettings.schema>;
