import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { bridgeSettings } from "../shared/settings.shared";
import { isIdList, parseIds } from "./ids.client";

interface Fields {
  botToken: string;
  agentId: string;
  allowedUserIds: string;
  allowedChatIds: string;
  ffmpegPath: string;
  whisperCliPath: string;
  whisperModelPath: string;
}

const idListError = (text: string) => (isIdList(text) ? undefined : "Ids are whole numbers, separated by commas.");

export function BridgeSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(bridgeSettings);
  const [draft, setDraft] = useState<{ fields: Fields; revision: string } | null>(null);
  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Telegram bridge">
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
          {settings.error}
        </Text>
        <SettingsCard>
          <SettingsAction label="Read settings again" actionLabel="Reload" onPress={settings.reload} />
          {settings.status === "invalid" ? (
            <SettingsAction label="Replace the invalid settings with empty ones" actionLabel="Reset" disabled={settings.saving} onPress={() => void settings.reset()} />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  const { values, revision } = settings;
  const saved: Fields = {
    botToken: values.botToken,
    agentId: values.agentId,
    allowedUserIds: values.allowedUserIds.join(", "),
    allowedChatIds: values.allowedChatIds.join(", "),
    ffmpegPath: values.ffmpegPath,
    whisperCliPath: values.whisperCliPath,
    whisperModelPath: values.whisperModelPath,
  };
  const shown = draft?.fields ?? saved;
  const edit = (key: keyof Fields) => (text: string) =>
    setDraft((current) => ({ fields: { ...(current?.fields ?? saved), [key]: text }, revision: current?.revision ?? revision }));
  const userIdsError = idListError(shown.allowedUserIds);
  const chatIdsError = idListError(shown.allowedChatIds);
  function save() {
    if (!draft) return;
    const { fields } = draft;
    const next = {
      botToken: fields.botToken.trim(),
      agentId: fields.agentId.trim(),
      allowedUserIds: parseIds(fields.allowedUserIds),
      allowedChatIds: parseIds(fields.allowedChatIds),
      ffmpegPath: fields.ffmpegPath.trim(),
      whisperCliPath: fields.whisperCliPath.trim(),
      whisperModelPath: fields.whisperModelPath.trim(),
    };
    void settings.save(next, draft.revision).then((isSaved) => {
      if (isSaved) setDraft(null);
    });
  }
  return (
    <ScrollView contentContainerStyle={{ padding: layout.compact ? 0 : 8 }}>
      <SettingsSection title="Telegram bridge">
        <SettingsCard key={draft?.revision ?? revision}>
          <SettingsInput label="Bot token" hint="From @BotFather. Stored in this host's plugin settings." secureTextEntry initialValue={shown.botToken} onChangeText={edit("botToken")} />
          <SettingsInput label="Agent id" hint="The Paseo agent that Telegram messages go to." initialValue={shown.agentId} onChangeText={edit("agentId")} />
          <SettingsInput
            label="Allowed user ids"
            hint="Comma-separated. The plugin log shows the ids of anyone it ignored."
            error={userIdsError}
            initialValue={shown.allowedUserIds}
            onChangeText={edit("allowedUserIds")}
          />
          <SettingsInput
            label="Allowed chat ids"
            hint="Comma-separated. A group's id starts with -."
            error={chatIdsError}
            initialValue={shown.allowedChatIds}
            onChangeText={edit("allowedChatIds")}
          />
          <SettingsInput label="ffmpeg path" hint="Converts voice notes for whisper.cpp. ~/ is the daemon user's home." initialValue={shown.ffmpegPath} onChangeText={edit("ffmpegPath")} />
          <SettingsInput label="whisper-cli path" hint="whisper.cpp, which turns voice notes into text on this host." initialValue={shown.whisperCliPath} onChangeText={edit("whisperCliPath")} />
          <SettingsInput label="Whisper model path" hint="A ggml model file for whisper.cpp." initialValue={shown.whisperModelPath} onChangeText={edit("whisperModelPath")} />
          <SettingsAction
            label={settings.saveError ?? "The bridge restarts with the new settings when you save."}
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={draft === null || settings.saving || userIdsError !== undefined || chatIdsError !== undefined}
            onPress={save}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
