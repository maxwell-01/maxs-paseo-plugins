import { describe, expect, it } from "vitest";
import type { LiveAgent } from "../shared/teams.shared";
import { crewOf } from "./crew.client";

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
    const { crew } = crewOf([agent("loop", { "firstmate.role": "crew", "ticket-loop.run": "traqx-294-x" })]);
    expect(crew).toEqual([]);
  });
});
