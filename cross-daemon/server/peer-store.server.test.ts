import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPeerStore } from "./peer-store.server";

const tower = { serverId: "srv_tower", name: "tower", link: "https://app.paseo.sh/#offer=dG93ZXI" };

describe("createPeerStore", () => {
  it("reads no peers before any are written", () => {
    const store = createPeerStore(join(mkdtempSync(join(tmpdir(), "cd-")), "state"));
    expect(store.read()).toEqual([]);
  });

  it("returns the peers it wrote", () => {
    const store = createPeerStore(join(mkdtempSync(join(tmpdir(), "cd-")), "state"));
    store.write([tower]);
    expect(store.read()).toEqual([tower]);
  });

  it("keeps the links readable by the owner only, because each one grants full control of a daemon", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "cd-")), "state");
    createPeerStore(dir).write([tower]);
    expect(statSync(join(dir, "peers.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("keeps the file owner-only even when an interrupted write left a readable temp file", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "cd-")), "state");
    const store = createPeerStore(dir);
    store.write([]);
    writeFileSync(join(dir, "peers.json.tmp"), "[]", { mode: 0o644 });
    store.write([tower]);
    expect(statSync(join(dir, "peers.json")).mode & 0o777).toBe(0o600);
  });
});
