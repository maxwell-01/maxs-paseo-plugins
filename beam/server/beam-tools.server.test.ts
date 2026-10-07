import { describe, expect, it } from "vitest";
import { createFakeAgentPort } from "./agent-port.fake";
import type { AgentBeamPort, BeamInResult, BeamOutResult } from "./agent-beam.server";
import type { BeamHolder } from "./beam.server";
import { createBeamTools } from "./beam-tools.server";

const holder: BeamHolder = {
  workspaceId: "ws-1",
  workspaceName: "alpha",
  workspaceDir: "/work/alpha",
  mainPath: "/main",
  startedAt: "2026-01-01T10:00:00.000Z",
};
const port = createFakeAgentPort({ workspaces: {}, agents: {} }).port;

function tools(overrides: { beamIn?: BeamInResult; beamOut?: BeamOutResult; callerHolds?: boolean; holder?: BeamHolder | null; port?: AgentBeamPort | null } = {}) {
  const current = overrides.holder === undefined ? holder : overrides.holder;
  const agentBeam = {
    async status() {
      return current ? { active: true as const, holder: current, callerHolds: overrides.callerHolds ?? false } : { active: false as const, callerHolds: false };
    },
    async beamIn() {
      return overrides.beamIn ?? { result: "beamed-in" as const };
    },
    async beamOut() {
      return overrides.beamOut ?? { result: "beamed-out" as const };
    },
  };
  const beamTools = createBeamTools({ agentBeam, paseo: () => (overrides.port === undefined ? port : overrides.port) });
  const caller = { callerAgentId: "agent-a" as string | null, signal: new AbortController().signal };
  return { call: (name: string, args: unknown = {}, who = caller) => beamTools.call(name, args, who), definitions: beamTools.definitions };
}

describe("beam tools", () => {
  it("offers beam_status, beam_in and beam_out, and says how beam_in waits", () => {
    const { definitions } = tools();
    expect(definitions.map((tool) => tool.name)).toEqual(["beam_status", "beam_in", "beam_out"]);
    const description = definitions.find((tool) => tool.name === "beam_in")?.description ?? "";
    expect(description).toContain("300 s");
    expect(description).toContain("beam_out");
  });

  it("reports who holds the beam and whether the caller does", async () => {
    const result = await tools({ callerHolds: true }).call("beam_status");
    expect(JSON.parse(result.text)).toEqual({
      active: true,
      workspaceId: "ws-1",
      workspaceName: "alpha",
      workspaceDir: "/work/alpha",
      startedAt: holder.startedAt,
      youHoldIt: true,
    });
  });

  it("reports an idle beam", async () => {
    const result = await tools({ holder: null }).call("beam_status");
    expect(JSON.parse(result.text)).toEqual({ active: false, youHoldIt: false });
  });

  it("rejects a wait above 300 seconds", async () => {
    const result = await tools().call("beam_in", { waitSeconds: 301 });
    expect(result.isError).toBe(true);
  });

  it("says another workspace holds the beam and what to do next", async () => {
    const result = await tools({ beamIn: { result: "held", holder, waitedSeconds: 5 } }).call("beam_in");
    expect(result.text).toBe(
      'Beam is held by workspace "alpha" (/work/alpha) since 2026-01-01T10:00:00.000Z. Call beam_in again to keep waiting; call beam_status first if a call timed out.',
    );
  });

  it("says the workspace is already beaming", async () => {
    const result = await tools({ beamIn: { result: "already-yours" } }).call("beam_in");
    expect(result.text).toContain("already beaming");
    expect(result.isError).toBeUndefined();
  });

  it("reports an aborted wait as an error", async () => {
    const result = await tools({ beamIn: { result: "aborted" } }).call("beam_in");
    expect(result.isError).toBe(true);
  });

  it("beams out, names the holder when it is someone else, and says when nothing is beaming", async () => {
    expect((await tools().call("beam_out")).text).toContain("Beamed out");
    expect((await tools({ beamOut: { result: "not-yours", holder } }).call("beam_out")).text).toContain('"alpha"');
    expect((await tools({ beamOut: { result: "no-beam" } }).call("beam_out")).text).toContain("Nothing is beaming");
  });

  it("refuses a caller that is not a Paseo agent", async () => {
    const result = await tools().call("beam_status", {}, { callerAgentId: null, signal: new AbortController().signal });
    expect(result).toEqual({ text: "beam tools only work inside a Paseo agent (PASEO_AGENT_ID is not set)", isError: true });
  });

  it("asks the agent to retry before Beam has reached Paseo", async () => {
    const result = await tools({ port: null }).call("beam_in");
    expect(result).toEqual({ text: "Beam has not reached Paseo since it started; try again on your next turn, or open the Beam panel once", isError: true });
  });
});
