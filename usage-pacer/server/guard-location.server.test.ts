import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstMateHome, guardFile } from "./guard-location.server";

describe("guard location", () => {
  it("finds the first mate home under ~/.paseo when PASEO_HOME is not set", () => {
    expect(firstMateHome({})).toBe(join(homedir(), ".paseo", "plugin-data", "firstmate", "home"));
  });

  it("follows PASEO_HOME to the guard the first mate installed", () => {
    expect(guardFile({ PASEO_HOME: "/data/paseo" })).toBe(
      "/data/paseo/plugin-data/firstmate/home/data/subscription-usage-watch/assets/guard.py",
    );
  });
});
