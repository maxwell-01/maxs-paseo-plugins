import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuard } from "./guard-run.server";
import { writePacingOverrides } from "./pacing-overrides.server";
import { makeTempDir } from "./temp-dir.test-support";

// The real guard lives in Max's myStuff clone, which this repo's checkout does not have.
const realGuard = process.env.USAGE_PACER_GUARD;

const PASEO_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const home = process.env.FIRSTMATE_HOME;
const args = process.argv.slice(2);
appendFileSync(home + "/calls", JSON.stringify(args) + "\\n");
const usagePath = home + "/usage.json";
const usage = JSON.parse(readFileSync(usagePath, "utf8"));
const agent = (id) => usage.agents.find((candidate) => candidate.id === id);
if (args[0] === "stop") {
  agent(args[1]).status = "idle";
  console.log(JSON.stringify({ agentIds: [args[1]], stoppedCount: 1 }));
}
if (args[0] === "agent" && args[1] === "update") {
  const [key, value] = args[4].split("=");
  agent(args[2]).labels[key] = value;
}
writeFileSync(usagePath, JSON.stringify(usage));
`;

function firstMateHomeAt(fiveHourPct: number) {
  const home = makeTempDir("usage-pacer-boundary-");
  const data = join(home, "data/subscription-usage-watch");
  mkdirSync(data, { recursive: true });
  const paseo = join(home, "paseo");
  writeFileSync(paseo, PASEO_STUB);
  const node = join(home, "node");
  writeFileSync(node, '#!/bin/sh\nexec cat "$FIRSTMATE_HOME/usage.json"\n');
  for (const stub of [paseo, node]) chmodSync(stub, 0o755);
  writeFileSync(join(data, "config.json"), JSON.stringify({ cli: paseo, node, paseo_home: home }));
  const now = Date.now();
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  writeFileSync(
    join(home, "usage.json"),
    JSON.stringify({
      fetchedAt: at(0),
      bases: {},
      providers: [
        {
          providerId: "claude",
          status: "available",
          windows: [
            { id: "five_hour", usedPct: fiveHourPct, resetsAt: at(3_600_000) },
            { id: "weekly", usedPct: 30, resetsAt: at(3 * 86_400_000) },
          ],
        },
      ],
      agents: [
        { id: "first-mate", provider: "claude", status: "running", labels: {}, pendingPermissionCount: 0 },
        {
          id: "crewmate",
          provider: "claude",
          status: "running",
          labels: { "firstmate.role": "crew" },
          parentAgentId: "first-mate",
          pendingPermissionCount: 0,
        },
      ],
    }),
  );
  return { home, data };
}

function calls(home: string): string[][] {
  const path = join(home, "calls");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
}

async function runRealGuard(home: string) {
  const log = vi.fn();
  vi.stubEnv("HOME", home);
  await runGuard({ guard: realGuard ?? "", firstMateHome: home, log });
  return log;
}

describe.skipIf(!realGuard)("the real usage guard, run by the pacer (set USAGE_PACER_GUARD to a myStuff guard.py)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("holds the crewmate at 92% and leaves the first mate running", async () => {
    const { home, data } = firstMateHomeAt(92);
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    const made = calls(home);
    expect(made.filter(([command]) => command === "stop").map(([, id]) => id)).toEqual(["crewmate"]);
    const label = made.findIndex((call) => call.join(" ").startsWith("agent update crewmate --label usage-guard.held=claude"));
    expect(label).toBeGreaterThanOrEqual(0);
    expect(label).toBeLessThan(made.findIndex(([command]) => command === "stop"));
    expect(JSON.parse(readFileSync(join(data, "stopped.json"), "utf8"))).toEqual({
      crewmate: { provider: "claude", at: expect.any(Number) },
    });
    const gate = JSON.parse(readFileSync(join(data, "gate.json"), "utf8"));
    expect(gate.providers.claude).toMatchObject({ mode: "paused", reason: "actual usage >=90%" });
    const sends = made.filter(([command]) => command === "send");
    expect(sends.map(([, parent]) => parent)).toEqual(["first-mate"]);
    expect(sends[0][sends[0].indexOf("--prompt") + 1]).toContain("crewmate (claude: actual usage >=90%)");
  });

  it("holds the crewmate at 85% once the settings lower the hard stop to 80%", async () => {
    const { home, data } = firstMateHomeAt(85);
    await writePacingOverrides(join(data, "pacing-overrides.json"), { stop_pct: 80 });
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    expect(calls(home).filter(([command]) => command === "stop").map(([, id]) => id)).toEqual(["crewmate"]);
    const gate = JSON.parse(readFileSync(join(data, "gate.json"), "utf8"));
    expect(gate.providers.claude).toMatchObject({ mode: "paused", reason: "actual usage >=80%" });
  });

  it("stops nothing at 40%", async () => {
    const { home } = firstMateHomeAt(40);
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    expect(calls(home).filter(([command]) => command === "stop")).toEqual([]);
  });
});
