import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardFile, pacingOverridesFile, stateDir } from "./guard-location.server";

describe("guard location", () => {
  it("keeps the state under ~/.paseo when PASEO_HOME is not set", () => {
    expect(stateDir({})).toBe(join(homedir(), ".paseo", "plugin-data", "usage-pacer"));
  });

  it("follows PASEO_HOME for the guard and the pacing overrides", () => {
    const env = { PASEO_HOME: "/data/paseo" };
    expect(guardFile(env)).toBe("/data/paseo/plugin-data/usage-pacer/guard/guard.py");
    expect(pacingOverridesFile(env)).toBe("/data/paseo/plugin-data/usage-pacer/pacing-overrides.json");
  });
});
