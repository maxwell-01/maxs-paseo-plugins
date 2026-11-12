import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pacingDefaults } from "../shared/pacing.shared";
import { pacingDefaultsFrom, writePacingOverrides } from "./pacing-overrides.server";
import { makeTempDir } from "./temp-dir.test-support";

describe("pacing overrides", () => {
  it("writes only the settings the user set, under pacing.json's own keys", async () => {
    const file = join(makeTempDir("usage-pacer-data-"), "usage-pacer", "pacing-overrides.json");
    await writePacingOverrides(file, { weekly_pace: "whole_week", max_concurrency: 3 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ weekly_pace: "whole_week", max_concurrency: 3 });
    await writePacingOverrides(file, {});
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });

  it("reads the defaults from the pacing.json the guard ships with", () => {
    const shipped = JSON.parse(readFileSync(new URL("../guard/pacing.json", import.meta.url), "utf8"));
    expect(pacingDefaultsFrom()).toEqual(
      Object.fromEntries(Object.keys(pacingDefaults.shape).map((key) => [key, shipped[key]])),
    );
  });
});
