import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { createAgentBeam } from "./server/agent-beam.server";
import { withBeamTools } from "./server/agent-injection.server";
import { startAgentTools } from "./server/agent-tools-server.server";
import { beamIn, beamOut } from "./server/beam-rpc.server";
import { getBeamLog, status, stopAllBeams } from "./server/beam.server";
import { beamStateDir } from "./server/paseo-home.server";
import { registerStaleHolderRelease, releaseStaleHolder } from "./server/stale-holder.server";
import { beamActivate, beamDeactivate, beamLog, beamStatus } from "./shared/beam.shared";

type PaseoApi = PluginHookContext["paseo"];

const AGENT_POLL_MS = 1000;

async function startAgentToolsOrReport(paseo: () => PaseoApi | null) {
  try {
    return await startAgentTools({ stateDir: beamStateDir(), agentBeam: createAgentBeam({ pollMs: AGENT_POLL_MS }), paseo });
  } catch (error) {
    console.error("beam: the agent tools did not start", error);
    return null;
  }
}

export default function contribute(server: PluginServerContext) {
  let latestPaseo: PaseoApi | null = null;
  const remember = (paseo: PaseoApi) => {
    latestPaseo = paseo;
  };
  const agentTools = startAgentToolsOrReport(() => latestPaseo);

  server.handle(beamActivate, async (input, { paseo }) => {
    remember(paseo);
    await releaseStaleHolder(paseo);
    return beamIn(paseo, input);
  });
  server.handle(beamDeactivate, (_input, { paseo }) => {
    remember(paseo);
    return beamOut(paseo);
  });
  server.handle(beamStatus, (_input, { paseo }) => {
    remember(paseo);
    return status();
  });
  server.handle(beamLog, (_input, { paseo }) => {
    remember(paseo);
    return { entries: getBeamLog() };
  });
  registerStaleHolderRelease(server);
  server.on("workspace.archived", (_event, { paseo }) => remember(paseo));
  server.on("agent.turn_started", (_event, { paseo }) => remember(paseo));

  server.before("agent.create", async ({ request }, { paseo }) => {
    remember(paseo);
    const tools = await agentTools;
    if (!tools) return request;
    return { ...request, config: withBeamTools(request.config, tools.launch, tools.toolNames) };
  });

  return async () => {
    (await agentTools)?.stop();
    stopAllBeams();
  };
}
