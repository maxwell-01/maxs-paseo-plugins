export const TOOL_SERVER_NAME = "cross-daemon";

export type Received =
  | { kind: "message"; fromAgentId: string | null; daemonName: string; serverId: string; body: string }
  | { kind: "finished"; agentId: string; daemonName: string; serverId: string; body: string }
  | { kind: "not-delivered"; agentId: string; where: string; reason: string };

const MESSAGE_HEADER = /^\[cross-daemon ([0-9a-f]{8})\] Message from (?:agent (\S+)|a user or script) on daemon "(.*)" \(([^\s()]+)\)\. /;
const FINISH_HEADER = /^\[cross-daemon notice ([0-9a-f]{8})\] Agent (\S+) on daemon "(.*)" \(([^\s()]+)\) finished the task you sent it\. /;
const NOT_DELIVERED = /^\[cross-daemon notice\] Your message to agent (\S+) on (.+?) was not delivered: (.*)$/s;

// Only the marker in the plugin's own header can close the body, so a prompt cannot fake its end.
function readBody(lines: string[], marker: string): string | null {
  if (lines[1] !== `----- ${marker} begin -----`) return null;
  const end = lines.indexOf(`----- ${marker} end -----`, 2);
  return end === -1 ? null : lines.slice(2, end).join("\n");
}

export function parseReceived(text: string): Received | null {
  const lines = text.split("\n");
  const message = MESSAGE_HEADER.exec(lines[0]);
  if (message) {
    const body = readBody(lines, message[1]);
    return body === null ? null : { kind: "message", fromAgentId: message[2] ?? null, daemonName: message[3], serverId: message[4], body };
  }
  const finish = FINISH_HEADER.exec(lines[0]);
  if (finish) {
    const body = readBody(lines, finish[1]);
    return body === null ? null : { kind: "finished", agentId: finish[2], daemonName: finish[3], serverId: finish[4], body };
  }
  const notDelivered = NOT_DELIVERED.exec(text);
  return notDelivered ? { kind: "not-delivered", agentId: notDelivered[1], where: notDelivered[2], reason: notDelivered[3] } : null;
}
