import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.server";
import type { PacingOverrides } from "../shared/pacing.shared";
import { makeTempDir } from "./temp-dir.test-support";

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

function pacerHome() {
  const home = makeTempDir("usage-pacer-home-");
  vi.stubEnv("PASEO_HOME", home);
  const state = join(home, "plugin-data/usage-pacer");
  mkdirSync(state, { recursive: true });
  return state;
}

function withStubbedPaseo(state: string) {
  const node = join(state, "node");
  writeFileSync(node, `#!/bin/sh\nexec cat ${state}/usage.json\n`);
  chmodSync(node, 0o755);
  writeFileSync(join(state, "config.json"), JSON.stringify({ cli: "/bin/true", node }));
  writeFileSync(
    join(state, "usage.json"),
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      bases: {},
      agents: [],
      providers: [{ providerId: "claude", status: "available", windows: [] }, { providerId: "codex", status: "available", windows: [] }],
    }),
  );
}

describe("contribute", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("installs its own guard on start", async () => {
    const state = pacerHome();
    const stop = contribute(fakeServer().server);
    await vi.waitFor(() => expect(existsSync(join(state, "guard/guard.py"))).toBe(true));
    stop();
  });

  it("answers a turn start at once and runs the installed guard in the background", async () => {
    const state = pacerHome();
    withStubbedPaseo(state);
    const { server, handlers } = fakeServer();
    const stop = contribute(server);
    expect(handlers.get("agent.turn_started")?.()).toBeUndefined();
    await vi.waitFor(() => expect(existsSync(join(state, "gate.json"))).toBe(true), { timeout: 5_000 });
    stop();
  });

  it("watches every 3 minutes, which also keeps the change-notice baseline", async () => {
    const state = pacerHome();
    withStubbedPaseo(state);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const stop = contribute(fakeServer().server);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await vi.waitFor(() => expect(existsSync(join(state, "watch-state/last-notice.json"))).toBe(true), { timeout: 5_000 });
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands the saved pacing settings to the guard, and each later save", async () => {
    const overrides = join(pacerHome(), "pacing-overrides.json");
    const { server, saveSettings } = fakeServer({ stop_pct: 80 });
    const stop = contribute(server);
    await vi.waitFor(() => expect(JSON.parse(readFileSync(overrides, "utf8"))).toEqual({ stop_pct: 80 }));
    await saveSettings({ weekly_pace: "whole_week" });
    expect(JSON.parse(readFileSync(overrides, "utf8"))).toEqual({ weekly_pace: "whole_week" });
    stop();
  });

  it("serves the pacing.json defaults to the settings screen", async () => {
    pacerHome();
    const { server, rpcs } = fakeServer();
    const stop = contribute(server);
    expect(await rpcs.get("pacing.defaults")?.()).toEqual(
      expect.objectContaining({ stop_pct: 90, weekly_pace: "working_week" }),
    );
    stop();
  });
});
