import { describe, expect, it } from "vitest";
import type { LiveAgent } from "../shared/teams.shared";
import { crewOf, waitingOnYou } from "./crew.client";

function agent(id: string, labels: Record<string, string>, lastSaid: string | null = null): LiveAgent {
  return { id, title: id, status: "idle", model: null, needsYou: false, labels, updatedAt: "", lastSaid };
}

describe("crewOf", () => {
  it("finds the first mate and reads each crewmate's closing state line", () => {
    const { mate, crew } = crewOf([
      agent("fm", { "firstmate.role": "first-mate" }),
      agent("scout", { "firstmate.role": "crew", "firstmate.kind": "scout" }, "Mocked the views.\n\nworking: mocking up the Teams view"),
      agent("ship", { "firstmate.role": "crew" }, "needs-decision: guard cap is 1"),
      agent("quiet", { "firstmate.role": "crew" }, "No status line here."),
    ]);
    expect(mate?.id).toBe("fm");
    expect(crew.map((c) => [c.agent.id, c.state, c.line])).toEqual([
      ["scout", "working", "mocking up the Teams view"],
      ["ship", "needs-decision", "guard cap is 1"],
      ["quiet", null, "No status line here."],
    ]);
  });

  it("leaves ticket-loop agents to their run, even when the subscription guard labels them crew", () => {
    const { crew } = crewOf([
      agent("loop", { "firstmate.role": "crew", "ticket-loop.run": "traqx-294-x" }),
      agent("older-loop", { "firstmate.role": "crew", "firstmate.task": "ticket-loop:traqx" }),
    ]);
    expect(crew).toEqual([]);
  });
});

describe("waitingOnYou", () => {
  it("counts agents asking for a permission and crewmates that stopped for a decision", () => {
    const asking = { ...agent("asking", { "ticket-loop.run": "r" }), needsYou: true };
    const agents = [asking, agent("deciding", { "firstmate.role": "crew" }, "needs-decision: pick one"),
      agent("blocked", { "firstmate.role": "crew" }, "blocked: no access"), agent("busy", { "firstmate.role": "crew" }, "working: on it")];
    expect(waitingOnYou(agents, crewOf(agents).crew).map((a) => a.id)).toEqual(["asking", "deciding", "blocked"]);
  });
});
