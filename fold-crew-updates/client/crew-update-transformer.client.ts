import type { PluginClientContext } from "@getpaseo/plugin/client";
import { classifyCrewUpdate, crewUpdateKind } from "../shared/crew-update.shared";

export function foldCrewUpdates(client: PluginClientContext) {
  return client.addTimelineTransformer({
    id: "fold-crew-updates",
    query: { itemType: "user_message" },
    transform({ item }) {
      const data = classifyCrewUpdate(item.text);
      if (!data) return undefined;
      return { items: [{ type: "plugin", kind: crewUpdateKind, version: 1, data }] };
    },
  });
}
