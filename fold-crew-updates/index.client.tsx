import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CrewUpdateRow } from "./client/crew-update-row.client";
import { foldCrewUpdates } from "./client/crew-update-transformer.client";
import { crewUpdateData, crewUpdateKind } from "./shared/crew-update.shared";

export default function contribute(client: PluginClientContext) {
  const removeTransformer = foldCrewUpdates(client);
  const removeRenderer = client.addTimelineRenderer({
    kind: crewUpdateKind,
    version: 1,
    schema: crewUpdateData,
    Component: CrewUpdateRow,
  });
  return () => {
    removeTransformer();
    removeRenderer();
  };
}
