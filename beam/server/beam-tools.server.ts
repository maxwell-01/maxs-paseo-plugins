import { z } from "zod";
import { type AgentBeamPort, type createAgentBeam, MAX_WAIT_SECONDS } from "./agent-beam.server";
import type { BeamHolder } from "./beam.server";
import { defineTool, type ToolCaller, type ToolResult, type Tools } from "./tools.server";
import type { WaitingAgent } from "./waiting-agents.server";

const BEAM_IN_DESCRIPTION =
  "Beams your own workspace onto the main checkout, so the running dev environment shows your changes. " +
  `If another workspace holds the beam, waits up to waitSeconds for it (default and most: ${MAX_WAIT_SECONDS} s; ` +
  "0 checks once), then beams in. If it is still held, the reply names the agent holding it: message that agent that you are waiting, then call again. " +
  "Call beam_out when you are done testing.";

const error = (text: string): ToolResult => ({ text, isError: true });

const KEEP_WAITING = "Call beam_in again to keep waiting; call beam_status first if a call timed out.";

const describeAgent = (agentId: string, agentTitle: string | null | undefined) => (agentTitle ? `"${agentTitle}" (${agentId})` : agentId);

const describeHolder = (holder: BeamHolder | null) => {
  if (!holder) return "another workspace";
  const workspace = `workspace "${holder.workspaceName ?? holder.workspaceId}" (${holder.workspaceDir}) since ${holder.startedAt}`;
  return holder.agentId ? `agent ${describeAgent(holder.agentId, holder.agentTitle)} in ${workspace}` : workspace;
};

const describeQueue = (waiting: WaitingAgent[], callerAgentId?: string) =>
  waiting
    .map(({ agentId, agentTitle }, index) => `${index + 1}. ${describeAgent(agentId, agentTitle)}${agentId === callerAgentId ? " (you)" : ""}`)
    .join(", ");

function heldText(holder: BeamHolder | null, waiting: WaitingAgent[], callerAgentId: string) {
  const queue = waiting.length > 0 ? ` Agents waiting, in order: ${describeQueue(waiting, callerAgentId)}.` : "";
  const whoToTell = !holder
    ? ""
    : holder.agentId
      ? ` Message ${holder.agentId} to say you are waiting, if you have not already.`
      : " It was beamed in from the Paseo app, not by an agent, so wait for it.";
  return `Beam is held by ${describeHolder(holder)}.${queue}${whoToTell} ${KEEP_WAITING}`;
}

const queueForHolder = (waiting: WaitingAgent[], ask: string) =>
  waiting.length > 0 ? ` Agents waiting for the beam, in order: ${describeQueue(waiting)}. ${ask}` : "";

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
            holderAgentId: status.holder?.agentId,
            holderAgentTitle: status.holder?.agentTitle,
            youHoldIt: status.callerHolds,
            waiting: status.waiting,
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
            return {
              text: `Beamed in. Your workspace is now mirrored onto the main checkout. Call beam_out when you are done testing.${queueForHolder(outcome.waiting, "Tell them where they stand.")}`,
            };
          case "already-yours":
            return {
              text: `Your workspace is already beaming onto the main checkout.${queueForHolder(outcome.waiting, "Tell them where they stand if you have not already, and beam out as soon as you are done.")}`,
            };
          case "held":
            return { text: heldText(outcome.holder, outcome.waiting, agentId) };
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
            return {
              text: `Beamed out. The main checkout is restored.${queueForHolder(outcome.waiting, `Message ${outcome.waiting[0]?.agentId} that the beam is free.`)}`,
            };
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
