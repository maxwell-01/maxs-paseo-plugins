import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPeerStore } from "./peer-store.server";

const tower = { serverId: "srv_tower", name: "tower", link: "https://app.paseo.sh/#offer=tower" };

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
});
