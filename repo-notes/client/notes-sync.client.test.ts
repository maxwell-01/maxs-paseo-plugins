import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listNotes, readNotesFile, resolveNotesFile, writeNotes } from "../server/notes-store.server";
import { type DaemonPort, type NotesWrite, syncRepoNotes } from "./notes-sync.client";

const KEY = "github.com/maxwell-01/mystuff";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

interface StoredNotes {
  content: string;
  hash: string;
  modifiedAt: number;
}

function fakeDaemon(stored: Record<string, StoredNotes>, options: { listFails?: boolean; changesBeforeRead?: boolean } = {}) {
  const writes: NotesWrite[] = [];
  const port: DaemonPort = {
    list: vi.fn(async () => {
      if (options.listFails) throw new Error("host asleep");
      return Object.entries(stored).map(([key, { hash, modifiedAt }]) => ({ key, hash, modifiedAt }));
    }),
    read: vi.fn(async (key: string) => {
      const notes = stored[key];
      if (!notes) return null;
      return options.changesBeforeRead ? { ...notes, content: "edited after the list", hash: "c".repeat(64) } : notes;
    }),
    write: vi.fn(async (write: NotesWrite) => {
      writes.push(write);
      return true;
    }),
  };
  return { port, writes };
}

describe("syncRepoNotes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives the newest notes to a daemon with older notes, and one with none", async () => {
    const tower = fakeDaemon({ [KEY]: { content: "Newer.", hash: hashB, modifiedAt: 2_000 } });
    const mac = fakeDaemon({ [KEY]: { content: "Older.", hash: hashA, modifiedAt: 1_000 } });
    const laptop = fakeDaemon({});

    await syncRepoNotes([tower.port, mac.port, laptop.port]);

    expect(mac.writes).toEqual([{ key: KEY, content: "Newer.", modifiedAt: 2_000, expectedHash: hashA }]);
    expect(laptop.writes).toEqual([{ key: KEY, content: "Newer.", modifiedAt: 2_000, expectedHash: null }]);
    expect(tower.writes).toEqual([]);
  });

  it("reads and writes nothing when every daemon already has the same notes", async () => {
    const tower = fakeDaemon({ [KEY]: { content: "Same.", hash: hashA, modifiedAt: 1_000 } });
    const mac = fakeDaemon({ [KEY]: { content: "Same.", hash: hashA, modifiedAt: 1_000 } });

    await syncRepoNotes([tower.port, mac.port]);

    expect(tower.port.read).not.toHaveBeenCalled();
    expect(mac.port.read).not.toHaveBeenCalled();
    expect([...tower.writes, ...mac.writes]).toEqual([]);
  });

  it.each([["tower first"], ["mac first"]])("picks the same winner, whatever the host order, when two notes have the same change time (%s)", async (order) => {
    const tower = fakeDaemon({ [KEY]: { content: "Tower's.", hash: hashA, modifiedAt: 1_000 } });
    const mac = fakeDaemon({ [KEY]: { content: "Mac's.", hash: hashB, modifiedAt: 1_000 } });

    await syncRepoNotes(order === "tower first" ? [tower.port, mac.port] : [mac.port, tower.port]);

    expect(tower.writes).toEqual([{ key: KEY, content: "Mac's.", modifiedAt: 1_000, expectedHash: hashA }]);
    expect(mac.writes).toEqual([]);
  });

  it("leaves out a daemon that does not answer within ten seconds, so a sleeping host does not hold up the others", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon({ [KEY]: { content: "Notes.", hash: hashA, modifiedAt: 1_000 } });
    const mac = fakeDaemon({});
    const sleeping = fakeDaemon({});
    vi.mocked(sleeping.port.list).mockImplementation(() => new Promise(() => {}));

    const sync = syncRepoNotes([tower.port, mac.port, sleeping.port]);
    await vi.advanceTimersByTimeAsync(10_000);
    await sync;
    vi.useRealTimers();

    expect(mac.writes).toHaveLength(1);
    expect(sleeping.writes).toEqual([]);
  });

  it("leaves out a daemon that does not answer, and never writes to it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon({ [KEY]: { content: "Notes.", hash: hashA, modifiedAt: 1_000 } });
    const sleepingMac = fakeDaemon({}, { listFails: true });

    await syncRepoNotes([tower.port, sleepingMac.port]);

    expect(sleepingMac.writes).toEqual([]);
  });

  it("skips a repo whose notes changed on their daemon after the list, until the next sync", async () => {
    const tower = fakeDaemon({ [KEY]: { content: "Listed.", hash: hashB, modifiedAt: 2_000 } }, { changesBeforeRead: true });
    const mac = fakeDaemon({});

    await syncRepoNotes([tower.port, mac.port]);

    expect(mac.writes).toEqual([]);
  });

  it("still syncs the other repos when one repo's read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon({
      "github.com/x/broken": { content: "x", hash: hashA, modifiedAt: 1_000 },
      [KEY]: { content: "Notes.", hash: hashB, modifiedAt: 1_000 },
    });
    vi.mocked(tower.port.read).mockImplementation(async (key) => {
      if (key === "github.com/x/broken") throw new Error("read failed");
      return { content: "Notes.", hash: hashB, modifiedAt: 1_000 };
    });
    const mac = fakeDaemon({});

    await syncRepoNotes([tower.port, mac.port]);

    expect(mac.writes).toEqual([{ key: KEY, content: "Notes.", modifiedAt: 1_000, expectedHash: null }]);
  });
});

describe("syncRepoNotes on real notes folders", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function daemonFolder(notes?: { content: string; modifiedAt: number }): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-notes-sync-"));
    dirs.push(dir);
    if (notes) {
      const file = resolveNotesFile(dir, KEY);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, notes.content);
      utimesSync(file, new Date(notes.modifiedAt), new Date(notes.modifiedAt));
    }
    return dir;
  }

  const storePort = (dir: string): DaemonPort => ({
    list: () => listNotes(dir),
    read: (key) => readNotesFile(resolveNotesFile(dir, key)),
    write: (write) => writeNotes(dir, write),
  });

  it("brings every daemon to the newest notes, even with two apps syncing at once, and backs up the old notes once", async () => {
    const tower = daemonFolder({ content: "New rule.", modifiedAt: 2_000_000 });
    const mac = daemonFolder({ content: "Old rule.", modifiedAt: 1_000_000 });
    const laptop = daemonFolder();

    await Promise.all([
      syncRepoNotes([tower, mac, laptop].map(storePort)),
      syncRepoNotes([laptop, mac, tower].map(storePort)),
    ]);

    for (const dir of [tower, mac, laptop]) {
      expect(await readNotesFile(resolveNotesFile(dir, KEY))).toMatchObject({ content: "New rule.", modifiedAt: 2_000_000 });
    }
    expect(readFileSync(`${resolveNotesFile(mac, KEY)}.replaced`, "utf8")).toBe("Old rule.");
  });
});
