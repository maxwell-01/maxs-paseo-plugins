import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { sources } from "../shared/settings.shared";

export function SourcesSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(sources);
  const [draft, setDraft] = useState<{ repoRoots: string; stateRoot: string; skillDir: string } | null>(null);
  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.statusDanger, padding: 16 }}>{settings.error}</Text>;
  }
  const { values, revision } = settings;
  const shown = draft ?? { repoRoots: values.repoRoots.join(", "), stateRoot: values.stateRoot, skillDir: values.skillDir };
  const edit = (key: keyof typeof shown) => (text: string) => setDraft({ ...shown, [key]: text });
  function save() {
    const repoRoots = shown.repoRoots.split(",").map((root) => root.trim()).filter(Boolean);
    void settings.save({ repoRoots, stateRoot: shown.stateRoot.trim(), skillDir: shown.skillDir.trim() }, revision)
      .then((saved) => { if (saved) setDraft(null); });
  }
  return (
    <ScrollView contentContainerStyle={{ padding: layout.compact ? 0 : 8 }}>
      <SettingsSection title="Where Crew & Flows reads on this host">
        <SettingsCard>
          <SettingsInput label="Repo folders" hint="Comma-separated. Each git repo directly inside is checked for .claude/ticket-loop.json on origin/main."
            initialValue={shown.repoRoots} onChangeText={edit("repoRoots")} />
          <SettingsInput label="Run state folder" hint="Where loop.py's <run_dir>-state folders live." initialValue={shown.stateRoot} onChangeText={edit("stateRoot")} />
          <SettingsInput label="ticket-loop skill" hint="Holds skill: briefs and craft.md. ~ is this host's home." initialValue={shown.skillDir} onChangeText={edit("skillDir")} />
          <SettingsAction label={settings.saveError ?? "Applies the next time a tab refreshes."} actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={draft === null || settings.saving} onPress={save} />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
