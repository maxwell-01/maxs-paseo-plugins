import { describe, expect, it } from "vitest";
import { wakeSelf } from "./wake.server";

function attempt(outcomes: Array<"fails" | "works">, { stopOnFirstFailure = false } = {}) {
  let calls = 0;
  let isAwake = false;
  const logs: string[] = [];
  const stopping = new AbortController();
  const done = wakeSelf({
    async callOwnRpc() {
      const outcome = outcomes[calls] ?? "fails";
      calls += 1;
      if (outcome === "works") {
        isAwake = true;
        return;
      }
      if (stopOnFirstFailure) stopping.abort();
      throw new Error("daemon not ready");
    },
    isAwake: () => isAwake,
    signal: stopping.signal,
    log: (line) => logs.push(line),
    retryDelayMs: () => 1,
  });
  return { done, logs, calls: () => calls };
}

describe("waking the bridge at start-up", () => {
  it("stops after the first call that works", async () => {
    const run = attempt(["works"]);
    await run.done;
    expect(run.calls()).toBe(1);
    expect(run.logs).toEqual([]);
  });

  it("retries a failed call", async () => {
    const run = attempt(["fails", "fails", "works"]);
    await run.done;
    expect(run.calls()).toBe(3);
    expect(run.logs).toEqual([]);
  });

  it("gives up after five tries and says the bridge waits for the next agent turn", async () => {
    const run = attempt([]);
    await run.done;
    expect(run.calls()).toBe(5);
    expect(run.logs).toEqual(["telegram-bridge: could not start at once (daemon not ready); it starts at the next agent turn on this daemon"]);
  });

  it("does not call when an agent turn already woke it", async () => {
    let calls = 0;
    await wakeSelf({ callOwnRpc: async () => void (calls += 1), isAwake: () => true, signal: new AbortController().signal, log: () => {} });
    expect(calls).toBe(0);
  });

  it("stops retrying, without a log line, once the plugin stops", async () => {
    const run = attempt([], { stopOnFirstFailure: true });
    await run.done;
    expect(run.calls()).toBe(1);
    expect(run.logs).toEqual([]);
  });
});
