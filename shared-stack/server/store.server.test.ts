import { mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyState } from "./queue.server";
import { createQueueStore } from "./store.server";

describe("queue store", () => {
  it("writes the queue group-writable and reads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "shared-stack-"));
    const store = createQueueStore(dir, "alice");
    store.update((state) => ({ ...state, daemons: { alice: "2026-10-30T12:00:00.000Z" } }));
    expect(store.read().daemons).toEqual({ alice: "2026-10-30T12:00:00.000Z" });
    expect(statSync(join(dir, "queue.json")).mode & 0o777).toBe(0o660);
  });

  it("breaks a lock left behind by a process that died", () => {
    const dir = mkdtempSync(join(tmpdir(), "shared-stack-"));
    writeFileSync(join(dir, "queue.lock"), "dead");
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, "queue.lock"), old, old);
    const store = createQueueStore(dir, "alice");
    expect(store.update(() => emptyState()).waiting).toEqual([]);
  });

  it("does not rewrite the file when nothing changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "shared-stack-"));
    const store = createQueueStore(dir, "alice");
    store.update((state) => state);
    expect(() => statSync(join(dir, "queue.json"))).toThrow();
  });
});
