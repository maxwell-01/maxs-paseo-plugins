import { describe, expect, it } from "vitest";
import { writeRepoNotes } from "./repo-notes.shared";

describe("writeRepoNotes input", () => {
  const valid = { key: "github.com/maxwell-01/mystuff", content: "Squash on merge.", modifiedAt: 1_750_000_000_000, expectedHash: null };

  it("accepts a note for a repo key", () => {
    expect(writeRepoNotes.input.safeParse(valid).success).toBe(true);
  });

  it("refuses a key that would leave the notes folder", () => {
    expect(writeRepoNotes.input.safeParse({ ...valid, key: "github.com/../../etc" }).success).toBe(false);
  });

  it("refuses notes over 100 KB, counting bytes, not characters", () => {
    expect(writeRepoNotes.input.safeParse({ ...valid, content: "é".repeat(50_001) }).success).toBe(false);
  });

  it("refuses a change time more than five minutes ahead, so one bad clock cannot win every sync", () => {
    expect(writeRepoNotes.input.safeParse({ ...valid, modifiedAt: Date.now() + 6 * 60_000 }).success).toBe(false);
  });
});
