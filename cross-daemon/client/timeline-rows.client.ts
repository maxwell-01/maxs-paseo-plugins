import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { parseReceived, TOOL_SERVER_NAME, type Received } from "../shared/message-format.shared";

export const CROSS_DAEMON_ROW_KIND = "cross-daemon-row";

export const crossDaemonRowSchema = z.object({
  direction: z.enum(["received", "sent"]),
  tone: z.enum(["neutral", "running", "warning", "danger"]),
  title: z.string(),
  detail: z.string().optional(),
  body: z.string().optional(),
});
export type CrossDaemonRow = z.infer<typeof crossDaemonRowSchema>;

const shortId = (agentId: string) => agentId.slice(0, 8);

function describeReceived(received: Received): Omit<CrossDaemonRow, "direction"> {
  switch (received.kind) {
    case "message": {
      const sender = received.fromAgentId ? `agent ${shortId(received.fromAgentId)}` : "a user or script";
      return { tone: "neutral", title: `Message from ${sender} on ${received.daemonName}`, body: received.body };
    }
    case "finished":
      return { tone: "neutral", title: `Agent ${shortId(received.agentId)} on ${received.daemonName} finished`, body: received.body };
    case "not-delivered":
      return { tone: "danger", title: `Message to agent ${shortId(received.agentId)} on ${received.where} not delivered`, detail: received.reason };
  }
}

export const transformUserMessage: PluginTimelineTransformerContribution<"user_message">["transform"] = ({ item }) => {
  const received = parseReceived(item.text);
  if (!received) return undefined;
  const data: CrossDaemonRow = { direction: "received", ...describeReceived(received) };
  return { items: [{ type: "plugin", kind: CROSS_DAEMON_ROW_KIND, version: 1, data }] };
};

const SENT_TOOL_NAME = new RegExp(`^(?:mcp__${TOOL_SERVER_NAME}__|${TOOL_SERVER_NAME}\\.)(send_agent_prompt|create_agent|archive_agent)$`);

const toolDetailSchema = z.object({ input: z.unknown(), output: z.unknown() });
const sentInputSchema = z.object({
  daemon: z.string().optional(),
  agentId: z.string().optional(),
  cwd: z.string().optional(),
  prompt: z.string().optional(),
});
const textPartsSchema = z.array(z.object({ type: z.literal("text"), text: z.string() }));
const resultTextSchema = z.union([
  z.object({ output: z.string() }).transform((result) => result.output),
  z.object({ content: textPartsSchema }).transform((result) => result.content.map((part) => part.text).join("\n")),
]);
const errorTextSchema = z.union([
  z.string(),
  z.object({ content: z.string() }).transform((error) => error.content),
  z.object({ content: textPartsSchema }).transform((error) => error.content.map((part) => part.text).join("\n")),
  z.object({ message: z.string() }).transform((error) => error.message),
]);

type SentTool = "send_agent_prompt" | "create_agent" | "archive_agent";
type SentInput = z.infer<typeof sentInputSchema>;

const RUNNING_DETAIL: Record<SentTool, string> = {
  send_agent_prompt: "Sending…",
  create_agent: "Starting…",
  archive_agent: "Archiving…",
};

function describeSentCall(tool: SentTool, input: SentInput): { title: string; body?: string } {
  const { daemon, agentId, cwd, prompt } = input;
  const body = prompt === undefined ? {} : { body: prompt };
  switch (tool) {
    case "send_agent_prompt":
      return daemon && agentId
        ? { title: `Message to agent ${shortId(agentId)} on ${daemon}`, ...body }
        : { title: "Message to an agent on another daemon", ...body };
    case "create_agent":
      return daemon && cwd
        ? { title: `Start an agent on ${daemon} in ${cwd}`, ...body }
        : { title: "Start an agent on another daemon", ...body };
    case "archive_agent":
      return { title: daemon && agentId ? `Archive agent ${shortId(agentId)} on ${daemon}` : "Archive an agent on another daemon" };
  }
}

function sentCallState(tool: SentTool, status: string, error: unknown, output: unknown): Pick<CrossDaemonRow, "tone" | "detail"> {
  const result = resultTextSchema.safeParse(output);
  switch (status) {
    case "running":
      return { tone: "running", detail: RUNNING_DETAIL[tool] };
    case "canceled":
      return { tone: "warning", detail: "Canceled" };
    case "failed": {
      const failure = errorTextSchema.safeParse(error);
      return { tone: "danger", detail: failure.success ? failure.data : result.success ? result.data : "Failed" };
    }
    default:
      return result.success ? { tone: "neutral", detail: result.data } : { tone: "neutral" };
  }
}

export const transformToolCall: PluginTimelineTransformerContribution<"tool_call">["transform"] = ({ item }) => {
  const tool = SENT_TOOL_NAME.exec(item.name)?.[1];
  if (tool !== "send_agent_prompt" && tool !== "create_agent" && tool !== "archive_agent") return undefined;
  const detail = toolDetailSchema.safeParse(item.detail);
  const input = sentInputSchema.safeParse(detail.success ? detail.data.input : null);
  const data: CrossDaemonRow = {
    direction: "sent",
    ...describeSentCall(tool, input.success ? input.data : {}),
    ...sentCallState(tool, item.status, item.error, detail.success ? detail.data.output : null),
  };
  return { items: [{ type: "plugin", kind: CROSS_DAEMON_ROW_KIND, version: 1, data }] };
};
