import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { bundleChokidar, VENDORED_CHOKIDAR_PATH } from "./vendor-chokidar";

describe("vendored chokidar", () => {
  it("matches a fresh bundle of the pinned chokidar and readdirp releases", async () => {
    expect(await readFile(VENDORED_CHOKIDAR_PATH, "utf8")).toBe(await bundleChokidar());
  });

  it("bundles chokidar 5.0.0 and readdirp 5.1.1", async () => {
    const bundle = await bundleChokidar();
    expect(bundle).toContain("chokidar 5.0.0");
    expect(bundle).toContain("readdirp 5.1.1");
  });
});
