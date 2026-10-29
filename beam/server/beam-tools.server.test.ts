import { describe, expect, it } from "vitest";
import { createFakeAgentPort } from "./agent-port.fake";
import type { AgentBeamPort, BeamInResult, BeamOutResult } from "./agent-beam.server";
import type { BeamHolder } from "./beam.server";
import type { WaitingAgent } from "./waiting-agents.server";
import { createBeamTools } from "./beam-tools.server";

const holder: BeamHolder = {
  workspaceId: "ws-1",
  workspaceName: "alpha",
  workspaceDir: "/work/alpha",
  mainPath: "/main",
  startedAt: "2026-01-01T10:00:00.000Z",
};
const agentHolder: BeamHolder = { ...holder, agentId: "agent-q", agentTitle: "Browser QA" };
const evalWorker: WaitingAgent = { agentId: "agent-e", agentTitle: "Eval worker", workspaceName: "beta", since: "2026-01-01T10:05:00.000Z" };
const untitled: WaitingAgent = { agentId: "agent-u", agentTitle: null, workspaceName: "gamma", since: "2026-01-01T10:06:00.000Z" };
const port = createFakeAgentPort({ workspaces: {}, agents: {} }).port;

function tools(overrides: { beamIn?: BeamInResult; beamOut?: BeamOutResult; callerHolds?: boolean; holder?: BeamHolder | null; waiting?: WaitingAgent[]; port?: AgentBeamPort | null } = {}) {
  const current = overrides.holder === undefined ? holder : overrides.holder;
  const waiting = overrides.waiting ?? [];
  const agentBeam = {
    async status() {
      return current
        ? { active: true as const, holder: current, callerHolds: overrides.callerHolds ?? false, waiting }
        : { active: false as const, callerHolds: false, waiting: [] };
    },
    async beamIn() {
      return overrides.beamIn ?? { result: "beamed-in" as const, waiting: [] };
    },
    async beamOut() {
      return overrides.beamOut ?? { result: "beamed-out" as const, waiting: [] };
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
      waiting: [],
    });
  });

  it("names the holding agent and the agents waiting, in order", async () => {
    const result = await tools({ holder: agentHolder, waiting: [evalWorker, untitled] }).call("beam_status");
    expect(JSON.parse(result.text)).toMatchObject({
      holderAgentId: "agent-q",
      holderAgentTitle: "Browser QA",
      waiting: [evalWorker, untitled],
    });
  });

  it("reports an idle beam", async () => {
    const result = await tools({ holder: null }).call("beam_status");
    expect(JSON.parse(result.text)).toEqual({ active: false, youHoldIt: false, waiting: [] });
  });

  it("rejects a wait above 300 seconds", async () => {
    const result = await tools().call("beam_in", { waitSeconds: 301 });
    expect(result.isError).toBe(true);
  });

  it("says another workspace holds the beam and what to do next", async () => {
    const result = await tools({ beamIn: { result: "held", holder, waiting: [], waitedSeconds: 5 } }).call("beam_in");
    expect(result.text).toBe(
      'Beam is held by workspace "alpha" (/work/alpha) since 2026-01-01T10:00:00.000Z. It was beamed in from the Paseo app, not by an agent, so wait for it. Call beam_in again to keep waiting; call beam_status first if a call timed out.',
    );
  });

  it("names the holding agent, the queue and who to message when the beam is held", async () => {
    const result = await tools({ beamIn: { result: "held", holder: agentHolder, waiting: [evalWorker, untitled], waitedSeconds: 300 } }).call("beam_in", {}, {
      callerAgentId: "agent-u",
      signal: new AbortController().signal,
    });
    expect(result.text).toBe(
      'Beam is held by agent "Browser QA" (agent-q) in workspace "alpha" (/work/alpha) since 2026-01-01T10:00:00.000Z. ' +
        'Agents waiting, in order: 1. "Eval worker" (agent-e), 2. agent-u (you). ' +
        "Message agent-q to say you are waiting, if you have not already. Call beam_in again to keep waiting; call beam_status first if a call timed out.",
    );
  });

  it("says a beam started from the app has no agent to message", async () => {
    const result = await tools({ beamIn: { result: "held", holder, waiting: [evalWorker], waitedSeconds: 300 } }).call("beam_in");
    expect(result.text).toContain("It was beamed in from the Paseo app, not by an agent, so wait for it.");
  });

  it("says the workspace is already beaming", async () => {
    const result = await tools({ beamIn: { result: "already-yours", waiting: [] } }).call("beam_in");
    expect(result.text).toBe("Your workspace is already beaming onto the main checkout.");
    expect(result.isError).toBeUndefined();
  });

  it("tells the holder which agents are waiting for the beam", async () => {
    const result = await tools({ beamIn: { result: "already-yours", waiting: [evalWorker, untitled] } }).call("beam_in");
    expect(result.text).toBe(
      "Your workspace is already beaming onto the main checkout. " +
        'Agents waiting for the beam, in order: 1. "Eval worker" (agent-e), 2. agent-u. ' +
        "Tell them where they stand if you have not already, and beam out as soon as you are done.",
    );
  });

  it("tells a new holder which agents are still waiting", async () => {
    const result = await tools({ beamIn: { result: "beamed-in", waiting: [untitled] } }).call("beam_in");
    expect(result.text).toBe(
      "Beamed in. Your workspace is now mirrored onto the main checkout. Call beam_out when you are done testing. " +
        "Agents waiting for the beam, in order: 1. agent-u. Tell them where they stand.",
    );
  });

  it("asks the holder to tell the first waiting agent when it beams out", async () => {
    const result = await tools({ beamOut: { result: "beamed-out", waiting: [evalWorker, untitled] } }).call("beam_out");
    expect(result.text).toBe(
      "Beamed out. The main checkout is restored. " +
        'Agents waiting for the beam, in order: 1. "Eval worker" (agent-e), 2. agent-u. ' +
        "Message agent-e that the beam is free.",
    );
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
