import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View, type ViewStyle } from "react-native";

export type Tone = "neutral" | "accent" | "warning" | "success" | "danger";

export const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

export function toneColor(theme: PluginTheme, tone: Tone): string {
  const { colors } = theme;
  return { neutral: colors.foregroundMuted, accent: colors.accent, warning: colors.statusWarning,
    success: colors.statusSuccess, danger: colors.statusDanger }[tone];
}

export function Pill({ theme, tone = "neutral", dashed = false, children }: { theme: PluginTheme; tone?: Tone; dashed?: boolean; children: ReactNode }) {
  const color = toneColor(theme, tone);
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderStyle: dashed ? "dashed" : "solid", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
      <Text style={{ color, fontSize: 11 }}>{children}</Text>
    </View>
  );
}

export function Card({ theme, selected = false, style, children }: { theme: PluginTheme; selected?: boolean; style?: ViewStyle; children: ReactNode }) {
  return (
    <View style={[{ backgroundColor: theme.colors.surface1, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8,
      borderColor: selected ? theme.colors.accent : theme.colors.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" }}>{children}</Text>;
}

export function Chips({ theme, options, value, onChange }: { theme: PluginTheme; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange(option.id)}
            style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
              borderColor: active ? theme.colors.accent : theme.colors.border, backgroundColor: active ? theme.colors.surface2 : "transparent" }}>
            <Text style={{ color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 12 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ theme, label, value, mono = false }: { theme: PluginTheme; label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, width: 92 }}>{label}</Text>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, flex: 1, fontFamily: mono ? MONO : undefined }}>{value}</Text>
    </View>
  );
}

export function Notice({ theme, tone, children }: { theme: PluginTheme; tone: Tone; children: ReactNode }) {
  return <Text selectable style={{ color: toneColor(theme, tone), fontSize: 13 }}>{children}</Text>;
}
