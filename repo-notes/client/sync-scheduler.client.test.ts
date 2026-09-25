import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonPort } from "./notes-sync.client";
import { registerDaemon } from "./sync-scheduler.client";

function countingPort(list: DaemonPort["list"] = async () => []): DaemonPort {
  return { list: vi.fn(list), read: vi.fn(async () => null), write: vi.fn(async () => true) };
}

describe("sync scheduler", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.useRealTimers();
  });

  it("syncs once for a burst of daemons registering together, as when the app connects to every host", async () => {
    const tower = countingPort();
    const mac = countingPort();
    cleanups.push(registerDaemon(tower), registerDaemon(mac));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tower.list).toHaveBeenCalledTimes(1);
    expect(mac.list).toHaveBeenCalledTimes(1);
  });

  it("syncs again every minute while the app stays open, so an edit on one daemon spreads", async () => {
    const tower = countingPort();
    cleanups.push(registerDaemon(tower));
    await vi.advanceTimersByTimeAsync(1_000 + 60_000);
    expect(tower.list).toHaveBeenCalledTimes(2);
  });

  it("never runs two syncs at once, and runs one more after a sync that a request arrived during", async () => {
    let finishList = () => {};
    const slow = countingPort(() => new Promise((resolve) => (finishList = () => resolve([]))));
    cleanups.push(registerDaemon(slow));
    await vi.advanceTimersByTimeAsync(1_000);
    cleanups.push(registerDaemon(countingPort()));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(slow.list).toHaveBeenCalledTimes(1);
    finishList();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.list).toHaveBeenCalledTimes(2);
  });

  it("stops syncing a daemon once its plugin instance is disposed", async () => {
    const tower = countingPort();
    registerDaemon(tower)();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tower.list).not.toHaveBeenCalled();
  });
});
