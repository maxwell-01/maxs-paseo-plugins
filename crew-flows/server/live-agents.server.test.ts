import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import { isTeamAgent, lastSaid, liveAgentsLabelled, type SaidWhileLoaded, needsYou } from "./live-agents.server";

type FakeAgent = { id: string; status: string; updatedAt: string; said: string };

function fakePaseo(agents: FakeAgent[]) {
  const timelineReads: string[] = [];
  const paseo = {
    agents: {
      list: async () => ({
        entries: agents.map((a) => ({ agent: { id: a.id, title: a.id, status: a.status, model: null, labels: { "firstmate.role": "crew" },
          updatedAt: a.updatedAt, archivedAt: null } })),
        pageInfo: { nextCursor: null },
      }),
      ref: (id: string) => ({ timeline: { refetch: async () => {
        timelineReads.push(id);
        return { entries: [{ item: { type: "assistant_message", text: agents.find((a) => a.id === id)?.said } }] };
      } } }),
    },
  } as unknown as PluginHandlerContext["paseo"];
  return { paseo, timelineReads };
}

describe("lastSaid", () => {
  it("joins the assistant messages that close the timeline, past any notice", () => {
    expect(lastSaid([
      { type: "assistant_message", text: "earlier" },
      { type: "tool_call" },
      { type: "assistant_message", text: "Added a guard. " },
      { type: "assistant_message", text: "Running checks." },
      { type: "notification" },
    ])).toBe("Added a guard. Running checks.");
  });

  it("is null when the turn did not close with words", () => {
    expect(lastSaid([{ type: "assistant_message", text: "hi" }, { type: "user_message", text: "go" }])).toBeNull();
  });
});

describe("isTeamAgent", () => {
  it("keeps an agent with any label under a team prefix", () => {
    expect(isTeamAgent({ "crew-flows.run": "r" }, ["crew-flows."])).toBe(true);
    expect(isTeamAgent({ "crew-flowsy": "r", other: "x" }, ["crew-flows."])).toBe(false);
  });
});

describe("needsYou", () => {
  it("counts a permission or an error, not a finished turn", () => {
    expect(needsYou({ requiresAttention: true, attentionReason: "permission" })).toBe(true);
    expect(needsYou({ requiresAttention: true, attentionReason: "error" })).toBe(true);
    expect(needsYou({ requiresAttention: true, attentionReason: "finished" })).toBe(false);
    expect(needsYou({ requiresAttention: false })).toBe(false);
  });
});

describe("liveAgentsLabelled", () => {
  it("reads no timeline of a closed agent, which Paseo would first resume from disk", async () => {
    const { paseo, timelineReads } = fakePaseo([
      { id: "open", status: "idle", updatedAt: "t1", said: "working: tests" },
      { id: "shut", status: "closed", updatedAt: "t1", said: "blocked: needs a key" },
    ]);
    const { agents } = await liveAgentsLabelled(paseo, ["firstmate."], new Map());
    expect(timelineReads).toEqual(["open"]);
    expect(agents.map((a) => [a.id, a.lastSaid])).toEqual([["open", "working: tests"], ["shut", null]]);
  });

  it("keeps what an agent said while loaded once it closes, until it changes", async () => {
    const saidWhileLoaded: SaidWhileLoaded = new Map();
    await liveAgentsLabelled(fakePaseo([{ id: "a", status: "idle", updatedAt: "t1", said: "blocked: needs a key" }]).paseo, ["firstmate."], saidWhileLoaded);
    const closed = fakePaseo([{ id: "a", status: "closed", updatedAt: "t1", said: "" }]);
    expect((await liveAgentsLabelled(closed.paseo, ["firstmate."], saidWhileLoaded)).agents[0].lastSaid).toBe("blocked: needs a key");
    expect(closed.timelineReads).toEqual([]);
    const changed = fakePaseo([{ id: "a", status: "closed", updatedAt: "t2", said: "" }]);
    expect((await liveAgentsLabelled(changed.paseo, ["firstmate."], saidWhileLoaded)).agents[0].lastSaid).toBeNull();
  });
});
