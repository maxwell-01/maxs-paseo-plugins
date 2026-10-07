import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beamStateDir } from "./paseo-home.server";

describe("beamStateDir", () => {
  it("lives under ~/.paseo when PASEO_HOME is not set", () => {
    expect(beamStateDir({})).toBe(join(homedir(), ".paseo", "plugin-data", "beam"));
  });

  it("follows PASEO_HOME", () => {
    expect(beamStateDir({ PASEO_HOME: "/data/paseo" })).toBe("/data/paseo/plugin-data/beam");
  });

  it("expands a leading ~ in PASEO_HOME", () => {
    expect(beamStateDir({ PASEO_HOME: "~/custom" })).toBe(join(homedir(), "custom", "plugin-data", "beam"));
  });
});
