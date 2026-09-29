import type { Peer } from "../shared/cross-daemon.shared";
import type { PaseoCli } from "./paseo-cli.server";

export const mac: Peer = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=bWFj" };

type Where = "mac" | "local";
interface FakeAgent {
  status: string;
  updatedAt: string;
  lastText: string;
}

// Agents on the remote daemon and on this one, driven through the same commands the CLI offers.
export function fakeDaemons() {
  const agents = new Map<string, FakeAgent>();
  const delivered: { where: Where; agentId: string; text: string }[] = [];
  const runs: string[][] = [];
  const archived: string[] = [];
  let startTurnOnSend = true;
  let runFailure: Error | null = null;
  let firstTurnStarts = true;
  const handle = async (where: Where, args: readonly string[], promptText?: string) => {
    const [command, agentId] = args;
    if (command === "run") {
      runs.push([...args]);
      if (runFailure) throw runFailure;
      const id = `new-${runs.length}`;
      const status = firstTurnStarts ? "running" : "idle";
      agents.set(`${where}/${id}`, { status, updatedAt: new Date().toISOString(), lastText: "" });
      return JSON.stringify({ agentId: id, status: firstTurnStarts ? "running" : "created", provider: "claude", cwd: "/Users/max", title: null });
    }
    const agent = agents.get(`${where}/${agentId}`);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (command === "inspect") return JSON.stringify({ Id: agentId, Status: agent.status, UpdatedAt: agent.updatedAt });
    if (command === "logs") return agent.lastText;
    if (command === "archive") {
      archived.push(agentId);
      return JSON.stringify({ agentId, status: "archived" });
    }
    if (command === "send") {
      delivered.push({ where, agentId, text: promptText ?? "" });
      if (startTurnOnSend) Object.assign(agent, { status: "running", updatedAt: new Date().toISOString() });
      return "{}";
    }
    throw new Error(`unexpected command ${command}`);
  };
  const cli: PaseoCli = {
    run: (link, args, options) => {
      if (link !== mac.link) throw new Error("unknown link");
      return handle("mac", args, options?.promptText);
    },
    runLocal: (args, options) => handle("local", args, options?.promptText),
  };
  const put = (where: Where, agentId: string, status: string) =>
    agents.set(`${where}/${agentId}`, { status, updatedAt: "2020-01-01T00:00:00.000Z", lastText: "" });
  const finish = (where: Where, agentId: string, lastText: string) =>
    Object.assign(agents.get(`${where}/${agentId}`)!, { status: "idle", updatedAt: new Date().toISOString(), lastText });
  const setStatus = (where: Where, agentId: string, status: string) => Object.assign(agents.get(`${where}/${agentId}`)!, { status });
  return {
    cli,
    delivered,
    runs,
    archived,
    put,
    finish,
    setStatus,
    holdTurnsAfterSend: () => {
      startTurnOnSend = false;
    },
    failRuns: (error: Error) => {
      runFailure = error;
    },
    failFirstTurns: () => {
      firstTurnStarts = false;
    },
  };
}
