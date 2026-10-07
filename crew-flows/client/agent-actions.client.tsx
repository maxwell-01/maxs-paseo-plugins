import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, usePaseo } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export function ActionButton({ theme, label, primary = false, disabled = false, onPress }: {
  theme: PluginTheme; label: string; primary?: boolean; disabled?: boolean; onPress: () => void;
}) {
  const { colors } = theme;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={{ borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, opacity: disabled ? 0.5 : 1,
        backgroundColor: primary ? colors.accent : colors.surface2 }}>
      <Text style={{ color: primary ? colors.accentForeground : colors.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

// Open is hidden on apps that predate client navigation, as the SDK asks.
export function AgentActions({ theme, agentId, openLabel, navigation }: {
  theme: PluginTheme; agentId: string; openLabel: string; navigation: PluginSurfaceProps["navigation"];
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (text: string) => paseo.agents.ref(agentId).send(text),
    onSuccess: () => { setDraft(null); toast.show("Note sent", { variant: "success" }); },
    onError: (error) => toast.error(`Could not send the note: ${error.message}`),
  });
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {navigation ? <ActionButton theme={theme} primary label={openLabel} onPress={() => navigation.openAgent({ agentId })} /> : null}
        <ActionButton theme={theme} label={draft === null ? "Send a note…" : "Cancel"} onPress={() => setDraft(draft === null ? "" : null)} />
      </View>
      {draft !== null ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput value={draft} onChangeText={setDraft} placeholder="A follow-up for this agent" placeholderTextColor={theme.colors.foregroundMuted}
            style={{ flex: 1, color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 8 }} />
          <ActionButton theme={theme} primary label="Send" disabled={!draft.trim() || send.isPending} onPress={() => send.mutate(draft.trim())} />
        </View>
      ) : null}
    </View>
  );
}
