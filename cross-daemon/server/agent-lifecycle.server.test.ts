import { describe, expect, it } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import { createAgentLifecycle } from "./agent-lifecycle.server";
import { createMessageQueue } from "./message-queue.server";
import { createMessenger } from "./messenger.server";
import type { PaseoCli } from "./paseo-cli.server";
import { createStartedAgents } from "./started-agents.server";
import { makeTempDir } from "./temp-dir.test-support";
import { createTools } from "./tools.server";
import { createWatchList } from "./watch-list.server";

const mac: Peer = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=bWFj" };
type Where = "mac" | "local";

// The remote daemon's agents, and this daemon's, driven through the commands the CLI offers.
function fakeDaemons() {
  const agents = new Map<string, { status: string; updatedAt: string; lastText: string }>();
  const runs: string[][] = [];
  const archived: string[] = [];
  const delivered: { where: Where; agentId: string; text: string }[] = [];
  const put = (where: Where, agentId: string, status: string) =>
    agents.set(`${where}/${agentId}`, { status, updatedAt: "2020-01-01T00:00:00.000Z", lastText: "" });
  const handle = async (where: Where, args: readonly string[], promptText?: string) => {
    const [command, agentId] = args;
    if (command === "run") {
      runs.push([...args]);
      const id = `new-${runs.length}`;
      agents.set(`${where}/${id}`, { status: "running", updatedAt: new Date().toISOString(), lastText: "" });
      return JSON.stringify({ agentId: id, status: "running", provider: "claude", cwd: "/Users/max", title: null });
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
  const finish = (agentId: string, lastText: string) =>
    Object.assign(agents.get(`mac/${agentId}`)!, { status: "idle", updatedAt: new Date().toISOString(), lastText });
  return { cli, runs, archived, delivered, put, finish };
}

function toolsIn(dir: string, daemons: ReturnType<typeof fakeDaemons>) {
  const watches = createWatchList(dir);
  const readPeers = () => [mac];
  const messenger = createMessenger({ queue: createMessageQueue(dir), watches, readPeers, cli: daemons.cli });
  const lifecycle = createAgentLifecycle({ cli: daemons.cli, watches, startedAgents: createStartedAgents(dir) });
  const tools = createTools({ readPeers, cli: daemons.cli, messenger, lifecycle, ownDaemon: async () => ({ name: "tower", serverId: "srv_tower" }) });
  return { tools, watches, tick: () => messenger.runRound() };
}

function setup() {
  const daemons = fakeDaemons();
  const dir = makeTempDir("cd-lifecycle-");
  const { tools, watches, tick } = toolsIn(dir, daemons);
  const create = (input: object = {}, callerAgentId: string | null = "caller-1") =>
    tools.call("create_agent", { daemon: "mac", cwd: "/Users/max", prompt: "Update the plugins.", ...input }, { callerAgentId });
  const archive = (agentId: string) => tools.call("archive_agent", { daemon: "mac", agentId }, { callerAgentId: "caller-1" });
  return { ...daemons, dir, watches, tick, create, archive };
}

describe("create_agent", () => {
  it("starts the agent in exactly the given folder, in a workspace of its own, never the caller's", async () => {
    const t = setup();
    await t.create({ provider: "claude/haiku", title: "Plugin update" });
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0].slice(0, -1)).toEqual([
      "run",
      "--background",
      "--json",
      "--new-workspace=local",
      "--cwd=/Users/max",
      "--provider=claude/haiku",
      "--title=Plugin update",
      "--",
    ]);
  });

  it("leaves the provider and title to the daemon when none is given", async () => {
    const t = setup();
    await t.create();
    expect(t.runs[0].slice(0, -1)).toEqual(["run", "--background", "--json", "--new-workspace=local", "--cwd=/Users/max", "--"]);
  });

  it("returns the new agent's ID", async () => {
    const t = setup();
    expect(await t.create({ notifyOnFinish: false })).toEqual({ text: 'Started agent new-1 on mac in "/Users/max".' });
  });

  it("gives the new agent the sender header, so it can reply", async () => {
    const t = setup();
    await t.create();
    const firstMessage = t.runs[0].at(-1)!;
    expect(firstMessage).toContain('from agent caller-1 on daemon "tower" (srv_tower)');
    expect(firstMessage).toContain("Update the plugins.");
    expect(firstMessage).toContain('daemon "srv_tower" and agentId "caller-1"');
  });

  it("tells the caller when the new agent finishes, with its last message", async () => {
    const t = setup();
    t.put("local", "caller-1", "idle");
    expect((await t.create()).text).toBe('Started agent new-1 on mac in "/Users/max". You will be told when it finishes.');
    await t.tick();
    expect(t.delivered).toEqual([]);
    t.finish("new-1", "Both plugins updated.");
    await t.tick();
    expect(t.delivered).toHaveLength(1);
    expect(t.delivered[0]).toMatchObject({ where: "local", agentId: "caller-1" });
    expect(t.delivered[0].text).toContain("Both plugins updated.");
  });

  it("refuses a folder that is not an absolute path", async () => {
    const t = setup();
    for (const cwd of ["~/code", "code", "--help"]) {
      expect((await t.create({ cwd })).isError).toBe(true);
    }
    expect(t.runs).toEqual([]);
  });
});

describe("archive_agent", () => {
  it("archives an agent that create_agent started, even after a plugin restart", async () => {
    const t = setup();
    await t.create({ notifyOnFinish: false });
    t.finish("new-1", "Done.");
    const restarted = toolsIn(t.dir, t);
    const result = await restarted.tools.call("archive_agent", { daemon: "mac", agentId: "new-1" }, { callerAgentId: "caller-1" });
    expect(result).toEqual({ text: "Archived agent new-1 on mac." });
    expect(t.archived).toEqual(["new-1"]);
  });

  it("refuses an agent that create_agent did not start", async () => {
    const t = setup();
    t.put("mac", "maxs-session", "idle");
    expect(await t.archive("maxs-session")).toEqual({
      text: "Agent maxs-session on mac was not started with create_agent from this daemon, so archive_agent will not close it.",
      isError: true,
    });
    expect(t.archived).toEqual([]);
  });

  it("refuses a running agent", async () => {
    const t = setup();
    await t.create({ notifyOnFinish: false });
    expect(await t.archive("new-1")).toEqual({
      text: "Agent new-1 on mac is still working. Archive it once it is idle.",
      isError: true,
    });
    expect(t.archived).toEqual([]);
  });
});
