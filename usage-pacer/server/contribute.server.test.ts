import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.server";
import type { PacingOverrides } from "../shared/pacing.shared";
import { makeTempDir } from "./temp-dir.test-support";

const WATCH = "plugin-data/firstmate/home/data/subscription-usage-watch";

function fakeServer(saved: PacingOverrides = {}) {
  const handlers = new Map<string, () => unknown>();
  const rpcs = new Map<string, () => unknown>();
  const settingsListeners: ((state: { status: "ready"; revision: string; values: PacingOverrides }) => unknown)[] = [];
  const server = {
    on: vi.fn((name: string, handler: () => unknown) => handlers.set(name, handler)),
    handle: vi.fn((contract: { name: string }, handler: () => unknown) => rpcs.set(contract.name, handler)),
    registerSettings: vi.fn(() => ({
      read: async () => ({ status: "ready", revision: "1", values: saved }),
      subscribe: (listener: (typeof settingsListeners)[number]) => {
        settingsListeners.push(listener);
        return () => {};
      },
    })),
  };
  const saveSettings = (values: PacingOverrides) =>
    Promise.all(settingsListeners.map((listener) => listener({ status: "ready", revision: "2", values })));
  return { server: server as unknown as PluginServerContext, handlers, rpcs, saveSettings };
}

function homeWithGuard(guardSource: string) {
  const home = makeTempDir("usage-pacer-home-");
  mkdirSync(join(home, WATCH, "assets"), { recursive: true });
  writeFileSync(join(home, WATCH, "assets", "guard.py"), guardSource);
  vi.stubEnv("PASEO_HOME", home);
  return home;
}

describe("contribute", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("paces nothing and says why when the first mate has no usage guard", () => {
    vi.stubEnv("PASEO_HOME", makeTempDir("usage-pacer-home-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server, handlers } = fakeServer();
    contribute(server);
    expect(handlers.size).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^usage-pacer: no usage guard at .*guard\.py/));
  });

  it("answers a turn start at once and runs the guard in the background", async () => {
    const home = homeWithGuard("import os\nopen(os.environ['FIRSTMATE_HOME'] + '/ran', 'w').close()\n");
    const { server, handlers } = fakeServer();
    const stop = contribute(server);
    expect(handlers.get("agent.turn_started")?.()).toBeUndefined();
    await vi.waitFor(() => expect(existsSync(join(home, "plugin-data/firstmate/home/ran"))).toBe(true));
    stop();
  });

  it("hands the saved pacing settings to the guard, and each later save", async () => {
    const home = homeWithGuard("");
    const overrides = join(home, WATCH, "pacing-overrides.json");
    const { server, saveSettings } = fakeServer({ stop_pct: 80 });
    const stop = contribute(server);
    await vi.waitFor(() => expect(JSON.parse(readFileSync(overrides, "utf8"))).toEqual({ stop_pct: 80 }));
    await saveSettings({ weekly_pace: "whole_week" });
    expect(JSON.parse(readFileSync(overrides, "utf8"))).toEqual({ weekly_pace: "whole_week" });
    stop();
  });

  it("serves the pacing.json defaults to the settings screen", async () => {
    const home = homeWithGuard("");
    const config = join(home, WATCH, "assets/claudeConfig/skills/paced-workflows/config");
    mkdirSync(config, { recursive: true });
    const pacing = { weekly_target_pct: 90, contingency_5h_pct: 10, contingency_7d_pct: 10, emergency_5h_pct: 90,
      emergency_7d_pct: 90, stop_pct: 90, up_margin_pct: 15, max_concurrency: 10, weekly_pace: "working_week" };
    writeFileSync(join(config, "pacing.json"), JSON.stringify(pacing));
    const { server, rpcs } = fakeServer();
    const stop = contribute(server);
    expect(await rpcs.get("pacing.defaults")?.()).toEqual(pacing);
    stop();
  });
});
