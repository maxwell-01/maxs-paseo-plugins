import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardFiles } from "./guard-files.generated";
import { installGuard } from "./guard-install.server";
import { makeTempDir } from "./temp-dir.test-support";

describe("installGuard", () => {
  it("writes every embedded guard file into <state>/guard, with guard.py executable", async () => {
    const state = makeTempDir("usage-pacer-install-");
    await installGuard(state);
    const guardDir = join(state, "guard");
    expect(readdirSync(guardDir).sort()).toEqual(Object.keys(guardFiles).sort());
    for (const [name, text] of Object.entries(guardFiles)) expect(readFileSync(join(guardDir, name), "utf8")).toBe(text);
    expect(statSync(join(guardDir, "guard.py")).mode & 0o777).toBe(0o755);
  });

  it("replaces files left by an older version and leaves no temp files", async () => {
    const state = makeTempDir("usage-pacer-install-");
    await installGuard(state);
    await installGuard(state);
    expect(readdirSync(join(state, "guard")).sort()).toEqual(Object.keys(guardFiles).sort());
  });
});
