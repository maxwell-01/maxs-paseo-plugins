
import { describe, expect, it } from "vitest";
import { fakeDaemons, fakeTools } from "./fake-daemons.test-support";
import { makeTempDir } from "./temp-dir.test-support";

function setup() {
  const daemons = fakeDaemons();
  const { tools, queue, watches, tick } = fakeTools(makeTempDir("cd-notify-"), daemons);
  const send = (agentId: string, input: object = {}, callerAgentId: string | null = "caller-1") =>
    tools.call("send_agent_prompt", { daemon: "mac", agentId, prompt: "Run the tests.", ...input }, { callerAgentId });
  const noticesTo = (agentId: string) => daemons.delivered.filter((entry) => entry.where === "local" && entry.agentId === agentId);
  return { ...daemons, queue, watches, send, tick, noticesTo };
}

describe("notify on finish", () => {
  it("tells the sender when the agent finishes, with its last message", async () => {
    const t = setup();
    t.put("mac", "a1", "idle");
    t.put("local", "caller-1", "idle");
    expect((await t.send("a1")).text).toBe("Sent to agent a1 on mac. You will be told when it finishes.");
    await t.tick();
    expect(t.noticesTo("caller-1")).toEqual([]);
    t.finish("mac", "a1", "All 42 tests pass.");
    await t.tick();
    expect(t.noticesTo("caller-1")).toHaveLength(1);
    expect(t.noticesTo("caller-1")[0].text).toContain('Agent a1 on daemon "mac" (srv_mac) finished');
    expect(t.noticesTo("caller-1")[0].text).toContain("All 42 tests pass.");
    expect(t.watches.list()).toEqual([]);
  });

  it("waits until the sender is idle before telling it, so the notice never interrupts the sender's work", async () => {
    const t = setup();
    t.put("mac", "a1", "idle");
    t.put("local", "caller-1", "running");
    await t.send("a1");
    t.finish("mac", "a1", "Done.");
    await t.tick();
    expect(t.noticesTo("caller-1")).toEqual([]);
    t.setStatus("local", "caller-1", "idle");
    await t.tick();
    expect(t.noticesTo("caller-1")).toHaveLength(1);
  });

  it("does not count an agent as finished before its turn has started", async () => {
    const t = setup();
    t.put("mac", "a1", "idle");
    t.put("local", "caller-1", "idle");
    t.holdTurnsAfterSend();
    await t.send("a1");
    await t.tick();
    expect(t.noticesTo("caller-1")).toEqual([]);
    expect(t.watches.list()).toHaveLength(1);
  });

  it("watches a queued message only once it is delivered", async () => {
    const t = setup();
    t.put("mac", "a1", "running");
    t.put("local", "caller-1", "idle");
    await t.send("a1");
    expect(t.watches.list()).toEqual([]);
    t.finish("mac", "a1", "Finished its own task.");
    await t.tick();
    expect(t.watches.list()).toHaveLength(1);
    expect(t.noticesTo("caller-1")).toEqual([]);
    t.finish("mac", "a1", "Ran the tests.");
    await t.tick();
    expect(t.noticesTo("caller-1")[0].text).toContain("Ran the tests.");
  });

  it("sends no notice when the sender asks for none", async () => {
    const t = setup();
    t.put("mac", "a1", "idle");
    expect((await t.send("a1", { notifyOnFinish: false })).text).toBe("Sent to agent a1 on mac.");
    expect(t.watches.list()).toEqual([]);
  });

  it("sends no notice when no agent sent the message", async () => {
    const t = setup();
    t.put("mac", "a1", "idle");
    await t.send("a1", {}, null);
    expect(t.watches.list()).toEqual([]);
  });
});
