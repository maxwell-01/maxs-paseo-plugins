import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listNotes, resolveNotesFile, writeNotes } from "./notes-store.server";

const KEY = "github.com/maxwell-01/mystuff";
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempNotesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-notes-store-"));
  dirs.push(dir);
  return dir;
}

function putNotes(notesDir: string, key: string, content: string, modifiedAt: number): string {
  const file = resolveNotesFile(notesDir, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  utimesSync(file, new Date(modifiedAt), new Date(modifiedAt));
  return file;
}

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

describe("resolveNotesFile", () => {
  it("puts a repo's notes in its own folder under repos", () => {
    expect(resolveNotesFile("/data", KEY)).toBe("/data/repos/github.com/maxwell-01/mystuff/AGENTS.md");
  });

  it("refuses a key that would leave the notes folder", () => {
    expect(() => resolveNotesFile("/data", "github.com/../../etc")).toThrow();
  });
});

describe("listNotes", () => {
  it("lists every repo's notes with a hash of the text and the time it was last changed", async () => {
    const notesDir = tempNotesDir();
    putNotes(notesDir, KEY, "Rebase, never merge.", 1_750_000_000_000);
    putNotes(notesDir, "gitlab.example.com/group/sub/app", "Use pnpm.", 1_760_000_000_000);

    expect(await listNotes(notesDir)).toEqual(
      expect.arrayContaining([
        { key: KEY, hash: hashText("Rebase, never merge."), modifiedAt: 1_750_000_000_000 },
        { key: "gitlab.example.com/group/sub/app", hash: hashText("Use pnpm."), modifiedAt: 1_760_000_000_000 },
      ]),
    );
    expect(await listNotes(notesDir)).toHaveLength(2);
  });

  it("leaves out the backup of replaced notes and folders that are not repo keys", async () => {
    const notesDir = tempNotesDir();
    const file = putNotes(notesDir, KEY, "Current.", 1_750_000_000_000);
    writeFileSync(`${file}.replaced`, "Old.");
    mkdirSync(join(notesDir, "repos", "Not A Key"), { recursive: true });
    writeFileSync(join(notesDir, "repos", "Not A Key", "AGENTS.md"), "Stray.");

    expect((await listNotes(notesDir)).map((note) => note.key)).toEqual([KEY]);
  });

  it("still lists every other repo when one notes file is too large, and logs that one", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const notesDir = tempNotesDir();
    putNotes(notesDir, KEY, "Fine.", 1_750_000_000_000);
    putNotes(notesDir, "github.com/x/huge", "x".repeat(100_001), 1_750_000_000_000);

    expect((await listNotes(notesDir)).map((note) => note.key)).toEqual([KEY]);
    expect(logError).toHaveBeenCalledWith("repo-notes: left github.com/x/huge out of the sync", expect.any(Error));
  });

  it("lists nothing on a daemon with no notes yet", async () => {
    expect(await listNotes(tempNotesDir())).toEqual([]);
  });
});

describe("writeNotes", () => {
  it("writes the notes with the exact time they were changed on the daemon they came from", async () => {
    const notesDir = tempNotesDir();
    expect(await writeNotes(notesDir, { key: KEY, content: "Rebase, never merge.", modifiedAt: 1_750_000_000_001, expectedHash: null })).toBe(true);

    const file = resolveNotesFile(notesDir, KEY);
    expect(readFileSync(file, "utf8")).toBe("Rebase, never merge.");
    expect((await listNotes(notesDir))[0].modifiedAt).toBe(1_750_000_000_001);
  });

  it("keeps the notes it replaces beside the new ones", async () => {
    const notesDir = tempNotesDir();
    const file = putNotes(notesDir, KEY, "Old rule.", 1_750_000_000_000);
    await writeNotes(notesDir, { key: KEY, content: "New rule.", modifiedAt: 1_760_000_000_000, expectedHash: hashText("Old rule.") });

    expect(readFileSync(`${file}.replaced`, "utf8")).toBe("Old rule.");
    expect(readFileSync(file, "utf8")).toBe("New rule.");
  });

  it("keeps notes that were changed here after the sync listed them", async () => {
    const notesDir = tempNotesDir();
    const file = putNotes(notesDir, KEY, "Edited just now.", 1_760_000_000_000);

    const written = await writeNotes(notesDir, { key: KEY, content: "Synced copy.", modifiedAt: 1_770_000_000_000, expectedHash: hashText("Listed earlier.") });
    expect(written).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("Edited just now.");
  });

  it("keeps the backup of the replaced notes when the same write arrives twice", async () => {
    const notesDir = tempNotesDir();
    const file = putNotes(notesDir, KEY, "Max's edit.", 1_750_000_000_000);
    const write = { key: KEY, content: "Winner.", modifiedAt: 1_760_000_000_000, expectedHash: hashText("Max's edit.") };
    await writeNotes(notesDir, write);
    await writeNotes(notesDir, write);

    expect(readFileSync(`${file}.replaced`, "utf8")).toBe("Max's edit.");
  });

  it("leaves no temporary file behind", async () => {
    const notesDir = tempNotesDir();
    await writeNotes(notesDir, { key: KEY, content: "Notes.", modifiedAt: 1_750_000_000_000, expectedHash: null });
    expect(readdirSync(dirname(resolveNotesFile(notesDir, KEY)))).toEqual(["AGENTS.md"]);
  });
});
