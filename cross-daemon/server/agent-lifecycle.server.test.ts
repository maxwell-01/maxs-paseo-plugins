import { describe, expect, it } from "vitest";
import { fakeDaemons, fakeTools } from "./fake-daemons.test-support";
import { makeTempDir } from "./temp-dir.test-support";

function setup() {
  const daemons = fakeDaemons();
  const dir = makeTempDir("cd-lifecycle-");
  const { tools, watches, tick } = fakeTools(dir, daemons);
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
    t.finish("mac", "new-1", "Both plugins updated.");
    await t.tick();
    expect(t.delivered).toHaveLength(1);
    expect(t.delivered[0]).toMatchObject({ where: "local", agentId: "caller-1" });
    expect(t.delivered[0].text).toContain("Both plugins updated.");
  });

  it("warns that the agent may have started when the start timed out, so the caller does not start a second", async () => {
    const t = setup();
    t.failRuns(new Error("paseo timed out after 90 s"));
    expect(await t.create()).toEqual({
      text: "The start timed out, so an agent may have started on mac. Check list_agents before you try again; archive_agent cannot close it.",
      isError: true,
    });
  });

  it("reports an agent whose first prompt did not start, and sends no finish notice for it", async () => {
    const t = setup();
    t.put("local", "caller-1", "idle");
    t.failFirstTurns();
    expect(await t.create()).toEqual({
      text: "Agent new-1 was created on mac, but its first prompt did not start. Check it with get_agent_activity, or archive it with archive_agent.",
      isError: true,
    });
    expect(t.watches.list()).toEqual([]);
    expect(await t.archive("new-1")).toEqual({ text: "Archived agent new-1 on mac." });
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
    t.finish("mac", "new-1", "Done.");
    const restarted = fakeTools(t.dir, t);
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
