import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuard } from "./guard-run.server";
import { writePacingOverrides } from "./pacing-overrides.server";
import { makeTempDir } from "./temp-dir.test-support";

const realGuard = fileURLToPath(new URL("../guard/guard.py", import.meta.url));

const PASEO_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const home = process.env.USAGE_PACER_STATE;
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

function stateAt(weeklyPct: number) {
  const home = makeTempDir("usage-pacer-boundary-");
  const data = home;
  const paseo = join(home, "paseo");
  writeFileSync(paseo, PASEO_STUB);
  const node = join(home, "node");
  writeFileSync(node, '#!/bin/sh\nexec cat "$USAGE_PACER_STATE/usage.json"\n');
  for (const stub of [paseo, node]) chmodSync(stub, 0o755);
  writeFileSync(join(data, "config.json"), JSON.stringify({ cli: paseo, node, managed_labels: ["usage-pacer.role=worker"] }));
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
            { id: "weekly", usedPct: weeklyPct, resetsAt: at(3 * 86_400_000) },
          ],
        },
      ],
      agents: [
        { id: "manager", provider: "claude", status: "running", labels: {}, pendingPermissionCount: 0 },
        {
          id: "worker",
          provider: "claude",
          status: "running",
          labels: { "usage-pacer.role": "worker" },
          parentAgentId: "manager",
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
  vi.stubEnv("USAGE_PACER_STATE", home);
  await runGuard({ guard: realGuard, mode: "bootstrap", log });
  return log;
}

describe("the real usage guard, run by the pacer", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("holds the labelled worker at 92% and leaves its unlabelled manager running", async () => {
    const { home, data } = stateAt(92);
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    const made = calls(home);
    expect(made.filter(([command]) => command === "stop").map(([, id]) => id)).toEqual(["worker"]);
    const label = made.findIndex((call) => call.join(" ").startsWith("agent update worker --label usage-guard.held=claude"));
    expect(label).toBeGreaterThanOrEqual(0);
    expect(label).toBeLessThan(made.findIndex(([command]) => command === "stop"));
    expect(JSON.parse(readFileSync(join(data, "stopped.json"), "utf8"))).toEqual({
      worker: { provider: "claude", at: expect.any(Number) },
    });
    const gate = JSON.parse(readFileSync(join(data, "gate.json"), "utf8"));
    expect(gate.providers.claude).toMatchObject({ mode: "paused", reason: "actual usage >=90%" });
    const sends = made.filter(([command]) => command === "send");
    expect(sends.map(([, parent]) => parent)).toEqual(["manager"]);
    expect(sends[0][sends[0].indexOf("--prompt") + 1]).toContain("worker (claude: actual usage >=90%)");
  });

  it("holds the labelled worker at 85% once the settings lower the hard stop to 80%", async () => {
    const { home, data } = stateAt(85);
    await writePacingOverrides(join(data, "pacing-overrides.json"), { stop_pct: 80 });
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    expect(calls(home).filter(([command]) => command === "stop").map(([, id]) => id)).toEqual(["worker"]);
    const gate = JSON.parse(readFileSync(join(data, "gate.json"), "utf8"));
    expect(gate.providers.claude).toMatchObject({ mode: "paused", reason: "actual usage >=80%" });
  });

  it("stops nothing at 40%", async () => {
    const { home } = stateAt(40);
    const log = await runRealGuard(home);
    expect(log).not.toHaveBeenCalled();
    expect(calls(home).filter(([command]) => command === "stop")).toEqual([]);
  });
});
