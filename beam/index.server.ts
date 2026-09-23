import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createAgentNotices } from "./server/beam-agent-notice.server";
import { beamIn, beamOut } from "./server/beam-rpc.server";
import { notifyAgentAfterTurn } from "./server/beam-turn-end.server";
import { getBeamLog, status, stopAllBeams } from "./server/beam.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

export default function contribute(server: PluginServerContext) {
  const notices = createAgentNotices();

  server.handle(beamActivate, (input, { paseo }) => beamIn(paseo, notices, input));
  server.handle(beamDeactivate, (_input, { paseo }) => beamOut(paseo, notices));
  server.handle(beamStatus, status);
  server.handle(beamLog, () => ({ entries: getBeamLog() }));
  const stopNotifyingAfterTurns = server.on("agent.turn_ended", ({ agent, outcome }, { paseo }) =>
    notifyAgentAfterTurn(paseo, notices, agent, outcome),
  );

  return () => {
    stopNotifyingAfterTurns();
    stopAllBeams();
  };
}
