import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { startAgentTools } from "./server/agent-tools.server";
import { daemonName, pluginDataDir, readConfig } from "./server/config.server";
import { createEngine } from "./server/engine.server";
import { createStackTools } from "./server/tools.server";
import { stackQueueRelease, stackQueueStatus } from "./shared/shared-stack.shared";

export default function contribute(server: PluginServerContext) {
  let latestPaseo: PaseoApi | null = null;
  const remember = (paseo: PaseoApi) => {
    latestPaseo = paseo;
  };
  const dataDir = pluginDataDir();
  const engine = createEngine({ config: readConfig(dataDir), daemon: daemonName(), dataDir, paseo: () => latestPaseo });
  const agentTools = startAgentTools(dataDir, createStackTools(engine)).catch((error) => {
    console.error("shared-stack: the agent tools did not start", error);
    return null;
  });

  server.handle(stackQueueStatus, (_input, { paseo }) => {
    remember(paseo);
    const state = engine.read();
    const host = engine.readHost();
    return {
      daemon: engine.daemon,
      isHost: engine.isHost,
      sharedDir: engine.config.sharedDir,
      error: engine.lastError(),
      holder: state.holder ? { ...state.holder, snapshotAt: state.holder.snapshot?.at ?? null } : null,
      waiting: state.waiting,
      host: host ? { ...host, appliedAt: host.applied?.at ?? null } : null,
      events: state.events,
    };
  });
  server.handle(stackQueueRelease, ({ agentId }, { paseo }) => {
    remember(paseo);
    const place = engine.placeOf(engine.read(), { daemon: engine.daemon, agentId });
    if (place === null) return { ok: false };
    engine.leave({ daemon: engine.daemon, agentId }, "released from the Paseo app");
    return { ok: true };
  });

  server.on("agent.turn_started", (_event, { paseo }) => remember(paseo));
  server.before("agent.create", async ({ request }, { paseo }) => {
    remember(paseo);
    return (await agentTools)?.withPreapprovedTools(request) ?? request;
  });
  server.before("agent.session_open", async ({ request }, { paseo }) => {
    remember(paseo);
    return (await agentTools)?.withToolServer(request) ?? request;
  });

  return async () => {
    engine.stop();
    (await agentTools)?.stop();
  };
}
