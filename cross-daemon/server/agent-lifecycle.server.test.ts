import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  it("makes a workspace for the folder when the daemon has none, and starts the agent in it", async () => {
    const t = setup();
    await t.create({ provider: "claude/haiku", title: "Plugin update" });
    expect(t.workspaceCommands).toEqual([
      ["workspace", "ls", "--json"],
      ["workspace", "create", "--json", "--isolation=local", "--path=/Users/max", "--title=Plugin update"],
    ]);
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0].slice(0, -1)).toEqual([
      "run",
      "--background",
      "--json",
      "--workspace=wks-1",
      "--provider=claude/haiku",
      "--title=Plugin update",
      "--",
    ]);
  });

  it("starts the agent in the daemon's own workspace for that folder when there is one", async () => {
    const t = setup();
    t.putWorkspace("wks-home", "/Users/max");
    await t.create();
    expect(t.workspaceCommands).toEqual([["workspace", "ls", "--json"]]);
    expect(t.runs[0].slice(0, -1)).toEqual(["run", "--background", "--json", "--workspace=wks-home", "--"]);
  });

  it("does not use a workspace for a different folder, even one inside it", async () => {
    const t = setup();
    t.putWorkspace("wks-code", "/Users/max/code");
    await t.create();
    expect(t.workspaceCommands[1]).toContain("--path=/Users/max");
    expect(t.runs[0]).not.toContain("--workspace=wks-code");
  });

  it("archives the workspace it made when the agent could not be started in it", async () => {
    const t = setup();
    t.failRuns(new Error("Provider is required"));
    expect(await t.create()).toEqual({ text: "paseo on mac failed: Provider is required", isError: true });
    expect(t.workspaces.get("wks-1")?.archived).toBe(true);
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
    expect(await t.archive("new-1")).toEqual({ text: "Archived agent new-1 on mac, and the workspace create_agent made for it." });
  });

  it("reports both failures when the workspace it made cannot be archived after a failed start", async () => {
    const t = setup();
    t.failRuns(new Error("Provider is required"));
    t.failWorkspaceArchives(new Error("Workspace not found"));
    expect(await t.create()).toEqual({
      text: "paseo on mac failed: Provider is required. Workspace wks-1, made for the agent, is left: Workspace not found",
      isError: true,
    });
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
    expect(result).toEqual({ text: "Archived agent new-1 on mac, and the workspace create_agent made for it." });
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

  it("archives the workspace create_agent made, after the agent", async () => {
    const t = setup();
    await t.create({ notifyOnFinish: false });
    t.finish("mac", "new-1", "Done.");
    expect(await t.archive("new-1")).toEqual({ text: "Archived agent new-1 on mac, and the workspace create_agent made for it." });
    expect(t.archived).toEqual(["new-1"]);
    expect(t.workspaces.get("wks-1")?.archived).toBe(true);
  });

  it("keeps a workspace it did not make", async () => {
    const t = setup();
    t.putWorkspace("wks-home", "/Users/max");
    await t.create({ notifyOnFinish: false });
    t.finish("mac", "new-1", "Done.");
    expect(await t.archive("new-1")).toEqual({ text: "Archived agent new-1 on mac." });
    expect(t.workspaceCommands.filter(([, subcommand]) => subcommand === "archive")).toEqual([]);
  });

  it("keeps the workspace it made while another agent still works in that folder", async () => {
    const t = setup();
    await t.create({ notifyOnFinish: false });
    t.finish("mac", "new-1", "Done.");
    t.put("mac", "maxs-session", "idle", "/Users/max");
    expect(await t.archive("new-1")).toEqual({
      text: 'Archived agent new-1 on mac. Kept workspace wks-1: another agent is still in "/Users/max".',
    });
    expect(t.workspaces.get("wks-1")?.archived).toBe(false);
  });

  it("reports a workspace it could not archive, after archiving the agent", async () => {
    const t = setup();
    await t.create({ notifyOnFinish: false });
    t.finish("mac", "new-1", "Done.");
    t.failWorkspaceArchives(new Error("relay connection timed out"));
    expect(await t.archive("new-1")).toEqual({
      text: "Archived agent new-1 on mac, but could not archive workspace wks-1: relay connection timed out",
      isError: true,
    });
    expect(t.archived).toEqual(["new-1"]);
  });

  it("archives only the agent for a record kept before workspaces were recorded", async () => {
    const t = setup();
    writeFileSync(join(t.dir, "started-agents.json"), JSON.stringify([{ peerServerId: "srv_mac", agentId: "old-1" }]));
    t.put("mac", "old-1", "idle", "/Users/max");
    expect(await t.archive("old-1")).toEqual({ text: "Archived agent old-1 on mac." });
    expect(t.archived).toEqual(["old-1"]);
  });
});
