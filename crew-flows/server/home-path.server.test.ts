import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome } from "./home-path.server";

describe("expandHome", () => {
  it("expands ~ and ~/ to this host's home and leaves other paths alone", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/.claude/x")).toBe(join(homedir(), ".claude/x"));
    expect(expandHome("~other/x")).toBe("~other/x");
    expect(expandHome("/workspace")).toBe("/workspace");
  });
});
