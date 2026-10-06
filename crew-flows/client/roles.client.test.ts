import { describe, expect, it } from "vitest";
import type { Flow, Stage } from "../shared/flows.shared";
import { groupRoles, modelLabel, stageEffects } from "./roles.client";

function stage(id: string, extra: Partial<Stage> = {}): Stage {
  return {
    id, model: "claude-sonnet-5", thinking: "medium", persist: true, always: false,
    reviews: null, ownerApproves: false, asks: null, brief: null, ...extra,
  };
}

function flow(name: string, stages: Stage[]): Flow {
  return { name, repoDir: `/workspace/${name}`, remote: null, manifestPath: ".claude/ticket-loop.json",
    maxRounds: 3, stallSeconds: 420, queue: null, stages };
}

const traqx = flow("traqx", [stage("plan"), stage("plan-review", { reviews: "plan" }), stage("develop"),
  stage("code-review", { reviews: "develop" }), stage("qa", { reviews: "develop", persist: false }),
  stage("retro", { persist: false, always: true })]);
const gsmail = flow("gsmail", [stage("develop"), stage("plan"), stage("triage")]);

describe("groupRoles", () => {
  it("puts each stage id's variants together, known roles in loop order", () => {
    const roles = groupRoles([traqx, gsmail], null);
    expect(roles.map((r) => r.id)).toEqual(["plan", "plan-review", "develop", "code-review", "qa", "retro", "triage"]);
    expect(roles[0]).toMatchObject({ name: "Planner" });
    expect(roles[0].variants.map((v) => v.flow.name)).toEqual(["traqx", "gsmail"]);
    expect(roles[6]).toMatchObject({ name: "Triage", blurb: null });
  });

  it("keeps only the chosen repo's variants and drops roles it does not have", () => {
    expect(groupRoles([traqx, gsmail], "gsmail").map((r) => r.id)).toEqual(["plan", "develop", "triage"]);
  });
});

describe("modelLabel", () => {
  it("names Claude models the way the app does and tags other providers", () => {
    expect(modelLabel("claude-opus-5")).toBe("Opus 5");
    expect(modelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
    expect(modelLabel("codex/gpt-5.6-sol")).toBe("gpt-5.6-sol (Codex)");
  });
});

describe("stageEffects", () => {
  it("says a failing gate sends its findings back and a passing one carries them on", () => {
    expect(stageEffects(traqx, traqx.stages[1])).toEqual({
      persistence: "persistent within a ticket, deleted after",
      onFail: "findings go back to plan; every stage from plan re-runs, up to 3 rounds",
      onPass: "findings it still names carry to develop",
    });
  });

  it("says a failing producer ends the run and an always stage runs whatever happened", () => {
    expect(stageEffects(traqx, traqx.stages[2]).onFail).toBe("the run stops: nothing gates it");
    expect(stageEffects(traqx, traqx.stages[4])).toMatchObject({
      persistence: "fresh agent each time it runs",
      onPass: "findings it still names have no stage left to action them",
    });
    expect(stageEffects(traqx, traqx.stages[5])).toMatchObject({ onFail: "runs after any outcome", onPass: "runs after any outcome" });
  });
});
