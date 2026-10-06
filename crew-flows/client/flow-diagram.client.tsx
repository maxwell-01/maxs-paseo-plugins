import type { PluginTheme } from "@getpaseo/plugin";
import { Fragment, useState } from "react";
import { type LayoutRectangle, Text, View } from "react-native";
import type { Flow, Stage } from "../shared/flows.shared";
import { loopBacks } from "./diagram.client";
import { modelLabel } from "./roles.client";

const LANE = 26;
const BAR = 1.5;

function StageBox({ theme, stage }: { theme: PluginTheme; stage: Stage }) {
  const { colors } = theme;
  const tag = stage.reviews ? "GATE" : stage.always ? "ALWAYS" : null;
  return (
    <View style={{ borderWidth: 1, borderRadius: 8, padding: 10, gap: 2, backgroundColor: colors.surface1,
      borderStyle: stage.persist ? "solid" : "dashed", borderColor: stage.reviews ? colors.accent : colors.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>
        <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{stage.id}</Text>
        {tag ? <Text style={{ color: colors.accent, fontSize: 10, fontWeight: "700" }}>{tag}</Text> : null}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{modelLabel(stage.model)} · {stage.thinking}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
        {stage.persist ? "persistent" : "fresh each run"}
        {stage.ownerApproves ? <Text style={{ color: colors.statusWarning }}> · owner gate*</Text> : null}
      </Text>
    </View>
  );
}

// No SVG in plugin code: each loop-back is one View with three borders, open on the side facing the boxes.
export function FlowDiagram({ theme, flow, vertical }: { theme: PluginTheme; flow: Flow; vertical: boolean }) {
  const { colors } = theme;
  const [boxes, setBoxes] = useState<Record<number, LayoutRectangle>>({});
  const main = flow.stages.filter((stage) => !stage.always);
  const finals = flow.stages.filter((stage) => stage.always);
  const backs = loopBacks(flow.stages);
  const lanes = Math.max(0, ...backs.map((back) => back.lane + 1));
  const measured = Object.values(boxes);
  const rowEnd = Math.max(0, ...measured.map((box) => (vertical ? box.x + box.width : box.y + box.height)));
  const label = (gate: string, target: string) => `${gate} FAIL → ${target} · ≤${flow.maxRounds} rounds`;

  return (
    <View accessibilityLabel={backs.map((back) => label(back.gate, back.target)).join("; ")}>
      <View style={{ flexDirection: vertical ? "column" : "row", alignItems: "flex-start" }}>
        {main.map((stage, index) => (
          <Fragment key={stage.id}>
            {index > 0 ? (
              <Text style={{ color: colors.foregroundMuted, textAlign: "center", width: vertical ? "70%" : 18, alignSelf: vertical ? "flex-start" : "center" }}>
                {vertical ? "↓" : "→"}
              </Text>
            ) : null}
            <View style={vertical ? { width: "70%" } : { flex: 1, minWidth: 0 }}
              onLayout={(event) => { const layout = event.nativeEvent.layout; setBoxes((prev) => ({ ...prev, [index]: layout })); }}>
              <StageBox theme={theme} stage={stage} />
            </View>
          </Fragment>
        ))}
        {finals.map((stage) => (
          <View key={stage.id} style={vertical
            ? { width: "70%", marginTop: 16, gap: 4 }
            : { flex: 1, minWidth: 0, marginLeft: 14, paddingLeft: 14, gap: 4, borderLeftWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
            <Text style={{ color: colors.accent, fontSize: 11 }}>after any outcome</Text>
            <StageBox theme={theme} stage={stage} />
          </View>
        ))}
      </View>
      {backs.map((back) => {
        const target = boxes[back.from];
        const gate = boxes[back.to];
        if (!target || !gate) return null;
        const depth = (back.lane + 1) * (vertical ? 14 : LANE) - 6;
        if (vertical) {
          const top = target.y + target.height / 2;
          return (
            <Fragment key={back.gate}>
              <View style={{ position: "absolute", left: rowEnd, top, width: depth, height: gate.y + gate.height / 2 - top,
                borderColor: colors.statusDanger, borderTopWidth: BAR, borderRightWidth: BAR, borderBottomWidth: BAR }} />
              <Text style={{ position: "absolute", left: rowEnd - 4, top: top - 8, color: colors.statusDanger, fontSize: 10 }}>◀</Text>
            </Fragment>
          );
        }
        const left = target.x + target.width / 2;
        return (
          <Fragment key={back.gate}>
            <View style={{ position: "absolute", left, top: rowEnd, width: gate.x + gate.width / 2 - left, height: depth,
              borderColor: colors.statusDanger, borderLeftWidth: BAR, borderRightWidth: BAR, borderBottomWidth: BAR }} />
            <Text style={{ position: "absolute", left: left - 4, top: rowEnd - 5, color: colors.statusDanger, fontSize: 10 }}>▲</Text>
            <Text style={{ position: "absolute", left: left + 6, top: rowEnd + depth + 1, color: colors.statusDanger, fontSize: 11 }}>
              {label(back.gate, back.target)}
            </Text>
          </Fragment>
        );
      })}
      {vertical ? (
        backs.map((back) => <Text key={back.gate} style={{ color: colors.statusDanger, fontSize: 12, marginTop: 6 }}>↩ {label(back.gate, back.target)}</Text>)
      ) : (
        <View style={{ height: lanes * LANE + 14 }} />
      )}
    </View>
  );
}
