import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { guardFiles } from "../server/guard-files.generated";
import { GENERATED_GUARD_FILES_PATH, generateGuardFiles } from "./embed-guard";

describe("embedded guard files", () => {
  it("match the files in guard/, so a stale embed fails here", async () => {
    expect(await readFile(GENERATED_GUARD_FILES_PATH, "utf8")).toBe(await generateGuardFiles());
  });

  it("carry the runtime files and no tests", () => {
    expect(Object.keys(guardFiles).sort()).toEqual([
      "guard.py", "holds.py", "pace.py", "pace_alert.py", "pacing.json",
      "paseo-source.mjs", "policy.py", "slots.py", "state_dir.py", "usage_log.py",
    ]);
  });
});
