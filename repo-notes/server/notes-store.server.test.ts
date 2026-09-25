import { describe, expect, it } from "vitest";
import { resolveNotesFile } from "./notes-store.server";

describe("resolveNotesFile", () => {
  it("puts a repo's notes in its own folder under repos", () => {
    expect(resolveNotesFile("/data", "github.com/maxwell-01/mystuff")).toBe("/data/repos/github.com/maxwell-01/mystuff/AGENTS.md");
  });

  it("refuses a key that would leave the notes folder", () => {
    expect(() => resolveNotesFile("/data", "github.com/../../etc")).toThrow();
  });
});
