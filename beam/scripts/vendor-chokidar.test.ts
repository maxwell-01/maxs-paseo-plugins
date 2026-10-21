import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch as releasedWatch } from "chokidar";
import { describe, expect, it } from "vitest";
import { watch } from "../server/vendor/chokidar";
import { bundleChokidar, VENDORED_CHOKIDAR_PATH } from "./vendor-chokidar";

describe("vendored chokidar", () => {
  it("is declared with a signature the released chokidar satisfies", () => {
    const declared: typeof watch = releasedWatch;
    expect(declared).toBe(releasedWatch);
  });

  it("matches a fresh bundle of the pinned chokidar and readdirp releases", async () => {
    expect(await readFile(VENDORED_CHOKIDAR_PATH, "utf8")).toBe(await bundleChokidar());
  });

  it("bundles chokidar 5.0.0 and readdirp 5.1.1", async () => {
    const bundle = await bundleChokidar();
    expect(bundle).toContain("chokidar 5.0.0");
    expect(bundle).toContain("readdirp 5.1.1");
  });

  it("reports a file written in the watched folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beam-vendored-chokidar-"));
    const watcher = watch(dir, { ignoreInitial: true, usePolling: true, interval: 50 });
    try {
      const added = new Promise<string>((resolve) => watcher.on("all", (eventName, path) => resolve(`${eventName} ${path}`)));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await writeFile(join(dir, "new.txt"), "hello\n");
      expect(await added).toBe(`add ${join(dir, "new.txt")}`);
    } finally {
      await watcher.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
