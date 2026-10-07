import { join } from "node:path";
import { type AgentBeamPort, type createAgentBeam, MAX_WAIT_SECONDS } from "./agent-beam.server";
import { createBeamTools } from "./beam-tools.server";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";

const PROXY_TIMEOUT_MARGIN_SECONDS = 30;

export async function startAgentTools(options: {
  stateDir: string;
  agentBeam: ReturnType<typeof createAgentBeam>;
  paseo: () => AgentBeamPort | null;
}) {
  const socketPath = join(options.stateDir, "tools.sock");
  const tools = createBeamTools(options);
  const proxyPath = installToolProxy(options.stateDir, {
    socketPath,
    tools: tools.definitions,
    pluginTimeoutMs: (MAX_WAIT_SECONDS + PROXY_TIMEOUT_MARGIN_SECONDS) * 1000,
  });
  const stop = await serveTools(socketPath, tools);
  return { launch: { command: process.execPath, proxyPath }, toolNames: tools.definitions.map((tool) => tool.name), stop };
}
