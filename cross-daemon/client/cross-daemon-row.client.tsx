import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { crossDaemonRowSchema } from "./timeline-rows.client";

type RowProps = PluginTimelineItemProps<z.output<typeof crossDaemonRowSchema>>;

export function CrossDaemonRow({ item: { data }, theme, layout }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const { colors } = theme;
  const toneColor = { neutral: colors.foregroundMuted, running: colors.foregroundMuted, warning: colors.statusWarning, danger: colors.statusDanger }[data.tone];
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8, paddingVertical: 4, paddingLeft: layout.compact ? 8 : 10, borderLeftWidth: 1, borderLeftColor: colors.border },
      text: { flex: 1, gap: 2 },
      title: { color: colors.foreground, fontSize: 13 },
      detail: { color: toneColor, fontSize: 12 },
      body: { marginTop: 4, padding: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, borderRadius: 6 },
      bodyText: { color: colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );
  const header = (
    <View style={styles.row}>
      <Icon name={data.direction === "received" ? "ArrowDownLeft" : "ArrowUpRight"} size={14} color={toneColor} />
      <View style={styles.text}>
        <Text style={styles.title}>{data.title}</Text>
        {data.detail ? <Text style={styles.detail}>{data.detail}</Text> : null}
        {expanded && data.body ? (
          <View style={styles.body}>
            <Text selectable style={styles.bodyText}>
              {data.body}
            </Text>
          </View>
        ) : null}
      </View>
      {data.body ? <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={colors.foregroundMuted} /> : null}
    </View>
  );
  if (!data.body) return header;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
      {header}
    </Pressable>
  );
}
