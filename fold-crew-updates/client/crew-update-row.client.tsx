import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { CrewUpdateData } from "../shared/crew-update.shared";

export function CrewUpdateRow({ item, theme, layout }: PluginTimelineItemProps<CrewUpdateData>) {
  const [open, setOpen] = useState(false);
  const styles = useMemo(
    () => ({
      row: {
        paddingVertical: 6,
        paddingHorizontal: layout.compact ? 8 : 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        gap: 6,
      },
      header: { color: theme.colors.foregroundMuted, fontSize: 13 },
      body: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );
  const { source, summary, text } = item.data;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`Crew update from ${source}`}
      onPress={() => setOpen((value) => !value)}
    >
      <View style={styles.row}>
        <Text numberOfLines={open ? undefined : 1} style={styles.header}>
          {`${open ? "▾" : "▸"} ${source}${open ? "" : `: ${summary}`}`}
        </Text>
        {open ? <Text style={styles.body}>{text}</Text> : null}
      </View>
    </Pressable>
  );
}
