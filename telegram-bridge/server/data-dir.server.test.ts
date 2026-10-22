import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeDataDir } from "./data-dir.server";

describe("bridgeDataDir", () => {
  it("lives under ~/.paseo when PASEO_HOME is not set", () => {
    expect(bridgeDataDir({})).toBe(join(homedir(), ".paseo", "plugin-data", "telegram-bridge"));
  });

  it("follows PASEO_HOME", () => {
    expect(bridgeDataDir({ PASEO_HOME: "/data/paseo" })).toBe("/data/paseo/plugin-data/telegram-bridge");
  });

  it("expands a leading ~ in PASEO_HOME", () => {
    expect(bridgeDataDir({ PASEO_HOME: "~/custom" })).toBe(join(homedir(), "custom", "plugin-data", "telegram-bridge"));
  });
});
