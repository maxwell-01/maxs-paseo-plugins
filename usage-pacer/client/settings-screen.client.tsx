import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { pacingSettings, readPacingDefaults } from "../shared/pacing.shared";
import { type PacingDraft, type PacingKey, draftFrom, overridesFrom } from "./pacing-draft.client";

const NUMBER_FIELDS: { key: Exclude<PacingKey, "weekly_pace">; label: string; hint: string }[] = [
  { key: "weekly_target_pct", label: "Weekly target %", hint: "Weekly usage to reach by the end of the pace period." },
  { key: "contingency_5h_pct", label: "5-hour reserve %", hint: "The 5-hour ceiling is 100 minus this." },
  { key: "contingency_7d_pct", label: "Weekly reserve %", hint: "The weekly ceiling is 100 minus this." },
  { key: "emergency_5h_pct", label: "5-hour emergency ceiling %", hint: "5-hour usage that forces minimum pace." },
  { key: "emergency_7d_pct", label: "Weekly emergency ceiling %", hint: "Weekly usage that forces minimum pace." },
  { key: "stop_pct", label: "Hard stop %", hint: "Usage that pauses new work and stops crew." },
  { key: "up_margin_pct", label: "Raise margin %", hint: "Headroom a forecast needs below a limit before a raise." },
  { key: "max_concurrency", label: "Max agents", hint: "Most crew agents per provider. A whole number, 1 or more." },
];

export function PacingSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(pacingSettings);
  const callDefaults = useRpc(readPacingDefaults);
  const defaults = useQuery({ queryKey: ["pacing-defaults"], queryFn: () => callDefaults({}) });
  const [draft, setDraft] = useState<PacingDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  if (settings.status === "loading") return null;
  if (settings.status === "error") return <Text style={{ color: theme.colors.statusDanger, padding: 16 }}>{settings.error}</Text>;
  if (settings.status === "invalid") {
    return (
      <SettingsSection title="Pacing limits on this host">
        <SettingsCard>
          <SettingsAction label={`The saved limits are invalid: ${settings.error}`} actionLabel="Use pacing.json" onPress={() => void settings.reset()} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const { values, revision } = settings;
  const shown = draft ?? draftFrom(values);
  const edit = (key: PacingKey) => (text: string) => setDraft({ ...shown, [key]: text });
  const fallback = (key: PacingKey) => (defaults.data ? `pacing.json: ${defaults.data[key]}` : "pacing.json");
  function save() {
    const result = overridesFrom(shown);
    if ("error" in result) return setDraftError(result.error);
    setDraftError(null);
    void settings.save(result.overrides, revision).then((saved) => { if (saved) setDraft(null); });
  }
  const status = draftError ?? settings.saveError ?? (defaults.error ? `Could not read pacing.json: ${defaults.error.message}` : "Empty fields use pacing.json. Applies at the next guard run.");
  return (
    <ScrollView contentContainerStyle={{ padding: layout.compact ? 0 : 8 }}>
      <SettingsSection title="Pacing limits on this host">
        <SettingsCard key={revision}>
          {NUMBER_FIELDS.map(({ key, label, hint }) => (
            <SettingsInput key={key} label={label} hint={hint} placeholder={fallback(key)} initialValue={shown[key]} onChangeText={edit(key)} />
          ))}
          <SettingsSelect label="Weekly pace" hint="Working week reaches the weekly target by the end of Friday. Whole week paces evenly to the reset."
            value={shown.weekly_pace} onValueChange={edit("weekly_pace")}
            options={[{ label: fallback("weekly_pace"), value: "" }, { label: "Working week", value: "working_week" }, { label: "Whole week", value: "whole_week" }]} />
          <SettingsAction label={status} actionLabel={settings.saving ? "Saving…" : "Save"} disabled={draft === null || settings.saving} onPress={save} />
          <SettingsAction label="Clear every setting." actionLabel="Use pacing.json" disabled={settings.saving} onPress={() => void settings.reset().then((reset) => { if (reset) setDraft(null); })} />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
