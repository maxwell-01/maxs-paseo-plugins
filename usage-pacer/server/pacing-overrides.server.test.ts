import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pacingDefaultsFrom, writePacingOverrides } from "./pacing-overrides.server";
import { makeTempDir } from "./temp-dir.test-support";

const PACING = {
  stale_minutes: 5,
  max_concurrency: 10,
  up_margin_pct: 15,
  contingency_5h_pct: 10,
  contingency_7d_pct: 10,
  weekly_target_pct: 90,
  weekly_pace: "working_week",
  emergency_5h_pct: 90,
  emergency_7d_pct: 90,
  stop_pct: 90,
};

function installedGuard(pacing: object) {
  const assets = join(makeTempDir("usage-pacer-assets-"), "assets");
  const config = join(assets, "claudeConfig/skills/paced-workflows/config");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "pacing.json"), JSON.stringify(pacing));
  return join(assets, "guard.py");
}

describe("pacing overrides", () => {
  it("writes only the settings the user set, under pacing.json's own keys", async () => {
    const file = join(makeTempDir("usage-pacer-data-"), "subscription-usage-watch", "pacing-overrides.json");
    await writePacingOverrides(file, { weekly_pace: "whole_week", max_concurrency: 3 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ weekly_pace: "whole_week", max_concurrency: 3 });
    await writePacingOverrides(file, {});
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });

  it("reads the defaults from the pacing.json the guard was installed with", () => {
    const { stale_minutes: _unexposed, ...exposed } = PACING;
    expect(pacingDefaultsFrom(installedGuard(PACING))).toEqual(exposed);
  });

  it("refuses a pacing.json without a value the settings show", () => {
    const { stop_pct: _missing, ...older } = PACING;
    expect(() => pacingDefaultsFrom(installedGuard(older))).toThrow(/stop_pct/);
  });
});
