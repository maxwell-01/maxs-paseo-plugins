import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPacer, MIN_GAP_MS } from "./pacer.server";

function deferredRuns() {
  const finishers: Array<() => void> = [];
  const run = vi.fn(() => new Promise<void>((resolve) => finishers.push(resolve)));
  const finishLatest = async () => {
    finishers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { run, finishLatest };
}

describe("pacer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs at once on the first turn", () => {
    const { run } = deferredRuns();
    createPacer(run).poke();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("folds a burst of turns into one run and one trailing run after the gap", async () => {
    const { run, finishLatest } = deferredRuns();
    const pacer = createPacer(run);
    for (let turn = 0; turn < 10; turn++) pacer.poke();
    await finishLatest();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await finishLatest();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 3);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never starts a second run while one is still going", async () => {
    const { run, finishLatest } = deferredRuns();
    const pacer = createPacer(run);
    pacer.poke();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 2);
    pacer.poke();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await finishLatest();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs at once when the gap has passed since the last run", async () => {
    const { run, finishLatest } = deferredRuns();
    const pacer = createPacer(run);
    pacer.poke();
    await finishLatest();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    pacer.poke();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("starts nothing after it is stopped", async () => {
    const { run, finishLatest } = deferredRuns();
    const pacer = createPacer(run);
    pacer.poke();
    pacer.poke();
    pacer.stop();
    await finishLatest();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
