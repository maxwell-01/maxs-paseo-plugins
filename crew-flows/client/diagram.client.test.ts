import { describe, expect, it } from "vitest";
import type { Flow, Stage } from "../shared/flows.shared";
import { loopBacks, queueSummary } from "./diagram.client";

function stage(id: string, extra: Partial<Stage> = {}): Stage {
  return { id, model: "claude-sonnet-5", thinking: "medium", persist: true, always: false,
    reviews: null, ownerApproves: false, asks: null, brief: null, ...extra };
}

const homeassistant = [stage("plan"), stage("plan-review", { reviews: "plan" }), stage("develop"),
  stage("code-review", { reviews: "develop" }), stage("deploy", { persist: false }),
  stage("qa", { reviews: "develop", persist: false }), stage("retro", { always: true })];

describe("loopBacks", () => {
  it("draws each gate back to its target, sharing a lane only where the spans do not overlap", () => {
    expect(loopBacks(homeassistant)).toEqual([
      { gate: "plan-review", target: "plan", from: 0, to: 1, lane: 0 },
      { gate: "code-review", target: "develop", from: 2, to: 3, lane: 0 },
      { gate: "qa", target: "develop", from: 2, to: 5, lane: 1 },
    ]);
  });

  it("counts positions among the flow stages only, leaving always stages out", () => {
    const flow = [stage("retro", { always: true }), stage("develop"), stage("review", { reviews: "develop" })];
    expect(loopBacks(flow)).toEqual([{ gate: "review", target: "develop", from: 0, to: 1, lane: 0 }]);
  });
});

describe("queueSummary", () => {
  const flow = (queue: Flow["queue"]) => ({ queue }) as Pick<Flow, "queue">;

  it("says which issues the queue takes and how many", () => {
    expect(queueSummary(flow({ repo: "maxwell-01/traqx-bookings", labels: [], excludeLabels: ["blocked", "loop:active"], order: "oldest", maxTickets: 3 })))
      .toBe("queue: maxwell-01/traqx-bookings, oldest first, max 3 tickets, skips blocked, loop:active");
  });

  it("says a manifest with no queue runs one issue at a time", () => {
    expect(queueSummary(flow(null))).toBe("no queue: run one issue at a time");
  });
});
