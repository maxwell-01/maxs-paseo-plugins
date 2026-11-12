import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  it("replaces an older version's files, removes ones it no longer ships, and keeps __pycache__", async () => {
    const state = makeTempDir("usage-pacer-install-");
    const guardDir = join(state, "guard");
    mkdirSync(join(guardDir, "__pycache__"), { recursive: true });
    writeFileSync(join(guardDir, "guard.py"), "old");
    writeFileSync(join(guardDir, "gone.py"), "stale");
    await installGuard(state);
    expect(readFileSync(join(guardDir, "guard.py"), "utf8")).toBe(guardFiles["guard.py"]);
    expect(readdirSync(guardDir).sort()).toEqual(["__pycache__", ...Object.keys(guardFiles)].sort());
  });

  it("does not rewrite a file whose content is unchanged", async () => {
    const state = makeTempDir("usage-pacer-install-");
    await installGuard(state);
    const file = join(state, "guard", "policy.py");
    const before = statSync(file).ino;
    await installGuard(state);
    expect(statSync(file).ino).toBe(before);
  });
});
