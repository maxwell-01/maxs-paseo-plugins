import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createChatHistory } from "./chat-history.server";
import { makeTempDir } from "./temp-dir.test-support";

const at = (iso: string) => () => new Date(iso);

describe("chat history", () => {
  it("keeps one file per chat, readable by the daemon's user only, one line per message", () => {
    const dir = join(makeTempDir("tg-history-"), "history");
    const history = createChatHistory(dir, at("2026-10-24T09:30:00.000Z"));
    history.record(-100200, "Max in Home Server AI", "Is the Hell's Kitchen box up?\nIt was down.");
    history.record(-100200, "agent", "Yes, it is up.");
    history.record(111, "Max in direct chat", "hi");
    expect(history.fileFor(-100200)).toBe(join(dir, "-100200.log"));
    expect(readFileSync(history.fileFor(-100200), "utf8")).toBe(
      "2026-10-24T09:30:00.000Z Max in Home Server AI: Is the Hell's Kitchen box up? ⏎ It was down.\n2026-10-24T09:30:00.000Z agent: Yes, it is up.\n",
    );
    expect(readFileSync(history.fileFor(111), "utf8")).toBe("2026-10-24T09:30:00.000Z Max in direct chat: hi\n");
    expect(statSync(history.fileFor(111)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("keeps only the newest messages, and carries them over to a fresh history, as after a restart", () => {
    const dir = makeTempDir("tg-history-");
    const first = createChatHistory(dir, at("2026-10-24T09:30:00.000Z"));
    for (let n = 1; n <= 300; n += 1) first.record(111, "Max", `message ${n}`);
    createChatHistory(dir, at("2026-10-24T09:31:00.000Z")).record(111, "agent", "latest");
    const lines = readFileSync(first.fileFor(111), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(300);
    expect(lines[0]).toBe("2026-10-24T09:30:00.000Z Max: message 2");
    expect(lines.at(-1)).toBe("2026-10-24T09:31:00.000Z agent: latest");
  });
});
