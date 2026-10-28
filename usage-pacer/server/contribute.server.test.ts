import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.server";
import { makeTempDir } from "./temp-dir.test-support";

function fakeServer() {
  const handlers = new Map<string, () => unknown>();
  const server = { on: vi.fn((name: string, handler: () => unknown) => handlers.set(name, handler)) };
  return { server: server as unknown as PluginServerContext, handlers };
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
    const home = makeTempDir("usage-pacer-home-");
    const assets = join(home, "plugin-data/firstmate/home/data/subscription-usage-watch/assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "guard.py"), "import os\nopen(os.environ['FIRSTMATE_HOME'] + '/ran', 'w').close()\n");
    vi.stubEnv("PASEO_HOME", home);
    const { server, handlers } = fakeServer();
    const stop = contribute(server);
    expect(handlers.get("agent.turn_started")?.()).toBeUndefined();
    await vi.waitFor(() => expect(existsSync(join(home, "plugin-data/firstmate/home/ran"))).toBe(true));
    stop();
  });
});
