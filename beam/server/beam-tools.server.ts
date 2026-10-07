import { z } from "zod";
import { type AgentBeamPort, type createAgentBeam, MAX_WAIT_SECONDS } from "./agent-beam.server";
import type { BeamHolder } from "./beam.server";
import { defineTool, type ToolCaller, type ToolResult, type Tools } from "./tools.server";

const BEAM_IN_DESCRIPTION =
  "Beams your own workspace onto the main checkout, so the running dev environment shows your changes. " +
  `If another workspace holds the beam, waits up to waitSeconds for it (default and most: ${MAX_WAIT_SECONDS} s; ` +
  "0 checks once), then beams in. If it is still held, call again. Call beam_out when you are done testing.";

const error = (text: string): ToolResult => ({ text, isError: true });

const describeHolder = (holder: BeamHolder | null) =>
  holder ? `workspace "${holder.workspaceName ?? holder.workspaceId}" (${holder.workspaceDir}) since ${holder.startedAt}` : "another workspace";

export function createBeamTools({ agentBeam, paseo }: { agentBeam: ReturnType<typeof createAgentBeam>; paseo: () => AgentBeamPort | null }): Tools {
  const asAgent =
    <Input>(run: (port: AgentBeamPort, agentId: string, input: Input, caller: ToolCaller) => Promise<ToolResult>) =>
    async (input: Input, caller: ToolCaller): Promise<ToolResult> => {
      if (!caller.callerAgentId) return error("beam tools only work inside a Paseo agent (PASEO_AGENT_ID is not set)");
      const port = paseo();
      if (!port) return error("Beam has not reached Paseo since it started; try again on your next turn, or open the Beam panel once");
      return run(port, caller.callerAgentId, input, caller);
    };

  const tools = [
    defineTool({
      name: "beam_status",
      description: "Shows whether a workspace is beamed onto the main checkout, which one, and whether it is yours.",
      input: z.object({}),
      run: asAgent(async (port, agentId) => {
        const status = await agentBeam.status(port, agentId);
        return {
          text: JSON.stringify({
            active: status.active,
            workspaceId: status.holder?.workspaceId,
            workspaceName: status.holder?.workspaceName,
            workspaceDir: status.holder?.workspaceDir,
            startedAt: status.holder?.startedAt,
            youHoldIt: status.callerHolds,
          }),
        };
      }),
    }),
    defineTool({
      name: "beam_in",
      description: BEAM_IN_DESCRIPTION,
      input: z.object({ waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional() }),
      run: asAgent(async (port, agentId, { waitSeconds }, caller) => {
        const outcome = await agentBeam.beamIn(port, agentId, { waitSeconds, signal: caller.signal });
        switch (outcome.result) {
          case "beamed-in":
            return { text: "Beamed in. Your workspace is now mirrored onto the main checkout. Call beam_out when you are done testing." };
          case "already-yours":
            return { text: "Your workspace is already beaming onto the main checkout." };
          case "held":
            return {
              text: `Beam is held by ${describeHolder(outcome.holder)}. Call beam_in again to keep waiting; call beam_status first if a call timed out.`,
            };
          case "aborted":
            return error("The beam_in call was cancelled before it beamed in.");
        }
      }),
    }),
    defineTool({
      name: "beam_out",
      description: "Stops beaming your workspace and restores the main checkout. Only the workspace that holds the beam can do this.",
      input: z.object({}),
      run: asAgent(async (port, agentId) => {
        const outcome = await agentBeam.beamOut(port, agentId);
        switch (outcome.result) {
          case "beamed-out":
            return { text: "Beamed out. The main checkout is restored." };
          case "not-yours":
            return { text: `Not beamed out: Beam is held by ${describeHolder(outcome.holder)}. Only that workspace can beam out.`, isError: true };
          case "no-beam":
            return { text: "Nothing is beaming; there is nothing to beam out." };
        }
      }),
    }),
  ];

  return {
    definitions: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async call(name, args, caller) {
      const tool = tools.find((candidate) => candidate.name === name);
      return tool ? tool.call(args, caller) : error(`Unknown beam tool: ${name}`);
    },
  };
}
