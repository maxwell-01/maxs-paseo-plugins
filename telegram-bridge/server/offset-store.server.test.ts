import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOffsetStore } from "./offset-store.server";
import { makeTempDir } from "./temp-dir.test-support";

describe("offset store", () => {
  it("starts at 0 when nothing is saved", () => {
    expect(createOffsetStore(join(makeTempDir("tg-offset-"), "state.json")).read()).toBe(0);
  });

  it("returns the saved offset to a fresh store, as after a restart", () => {
    const file = join(makeTempDir("tg-offset-"), "nested", "state.json");
    createOffsetStore(file).write(42);
    expect(createOffsetStore(file).read()).toBe(42);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses a state file it cannot read rather than restarting from 0", () => {
    const file = join(makeTempDir("tg-offset-"), "state.json");
    writeFileSync(file, "{not json");
    expect(() => createOffsetStore(file).read()).toThrow();
  });
});
