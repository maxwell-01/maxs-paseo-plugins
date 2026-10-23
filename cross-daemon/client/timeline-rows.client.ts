import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { parseReceived, type Received } from "../shared/message-format.shared";

export const CROSS_DAEMON_ROW_KIND = "cross-daemon-row";

export const crossDaemonRowSchema = z.object({
  direction: z.enum(["received", "sent"]),
  tone: z.enum(["neutral", "running", "warning", "danger"]),
  title: z.string(),
  detail: z.string().optional(),
  body: z.string().optional(),
});
type CrossDaemonRow = z.infer<typeof crossDaemonRowSchema>;

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
