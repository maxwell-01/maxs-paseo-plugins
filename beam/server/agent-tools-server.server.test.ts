import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentBeam } from "./agent-beam.server";
import { startAgentTools } from "./agent-tools-server.server";
import { makeTempDir } from "./temp-dir.test-support";

const agentBeam = createAgentBeam({ pollMs: 1000 });

describe("startAgentTools", () => {
  it("starts the socket and installs the proxy", async () => {
    const tools = await startAgentTools({ stateDir: makeTempDir("beam-"), agentBeam, paseo: () => null });
    tools.stop();
    expect(tools.toolNames).toEqual(["beam_status", "beam_in", "beam_out"]);
    expect(tools.launch.proxyPath).toMatch(/tool-proxy\.cjs$/);
  });

  it("rejects when the socket cannot listen, so no agent is given tools that cannot answer", async () => {
    const stateDir = join(makeTempDir("beam-"), "x".repeat(200));
    await expect(startAgentTools({ stateDir, agentBeam, paseo: () => null })).rejects.toThrow();
  });
});
