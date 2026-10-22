import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planReply, type SendPolicy } from "./send-files.server";
import { makeTempDir } from "./temp-dir.test-support";

function fileOfSize(name: string, bytes: number) {
  const path = join(makeTempDir("tg-send-"), name);
  writeFileSync(path, "");
  truncateSync(path, bytes);
  return path;
}

function homes(): SendPolicy {
  const home = makeTempDir("tg-home-");
  const paseoHome = join(home, ".paseo");
  return { home, paseoHome, bridgeFilesDir: join(paseoHome, "plugin-data", "telegram-bridge", "files") };
}

describe("the [[send: /path]] convention", () => {
  it("takes each send line out of the text and sends an image as a photo, anything else as a file", async () => {
    const dir = makeTempDir("tg-send-");
    writeFileSync(join(dir, "chart.PNG"), "png");
    writeFileSync(join(dir, "data.csv"), "a,b");
    const reply = `Here is the chart.\n[[send: ${join(dir, "chart.PNG")}]]\n  [[send:${join(dir, "data.csv")}]]  \nEnjoy.`;
    expect(await planReply(reply, homes())).toEqual({
      body: "Here is the chart.\nEnjoy.",
      files: [
        { path: join(dir, "chart.PNG"), kind: "photo" },
        { path: join(dir, "data.csv"), kind: "document" },
      ],
    });
  });

  it("leaves a send marker inside a sentence or a code block as text", async () => {
    const reply = "Write [[send: /x]] on a line of its own, like this:\n```\n[[send: /absolute/path]]\n```";
    expect(await planReply(reply, homes())).toEqual({ body: reply, files: [] });
  });

  it("sends an image over the 10 MB photo limit as a file", async () => {
    const big = fileOfSize("big.jpg", 11 * 1024 * 1024);
    expect((await planReply(`[[send: ${big}]]`, homes())).files).toEqual([{ path: big, kind: "document" }]);
  });

  it("adds a line to the text for each file it cannot send", async () => {
    const folder = join(makeTempDir("tg-send-"), "folder");
    mkdirSync(folder);
    const huge = fileOfSize("huge.bin", 51 * 1024 * 1024);
    const reply = ["Done.", "[[send: notes.txt]]", "[[send: /no/such/file.txt]]", `[[send: ${folder}]]`, `[[send: ${huge}]]`].join("\n");
    expect(await planReply(reply, homes())).toEqual({
      body: [
        "Done.",
        "Could not send notes.txt: it is not an absolute path.",
        "Could not send /no/such/file.txt: ENOENT: no such file or directory, realpath '/no/such/file.txt'",
        `Could not send ${folder}: it is not a file.`,
        `Could not send ${huge}: it is over Telegram's 50 MB bot upload limit.`,
      ].join("\n\n"),
      files: [],
    });
  });

  it("never sends a secret: hidden files, hidden folders of the home folder, or Paseo's own folder", async () => {
    const { home, paseoHome, bridgeFilesDir } = homes();
    const key = join(home, ".ssh", "id_ed25519");
    const settings = join(paseoHome, "plugins", "settings.json");
    const env = join(makeTempDir("tg-send-"), ".env");
    const link = join(makeTempDir("tg-send-"), "innocent.txt");
    for (const path of [key, settings, env]) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "secret");
    }
    symlinkSync(key, link);
    const reply = [key, settings, env, link].map((path) => `[[send: ${path}]]`).join("\n");
    expect((await planReply(reply, { home, paseoHome, bridgeFilesDir })).body.split("\n\n")).toEqual([
      `Could not send ${key}: it is inside a hidden folder.`,
      `Could not send ${settings}: it is inside Paseo's own folder.`,
      `Could not send ${env}: it is a hidden file.`,
      `Could not send ${link}: it is inside a hidden folder.`,
    ]);
  });

  it("refuses a hidden folder deeper under the home folder, such as a repo's .git", async () => {
    const { home, paseoHome, bridgeFilesDir } = homes();
    const gitConfig = join(home, "project", ".git", "config");
    mkdirSync(join(gitConfig, ".."), { recursive: true });
    writeFileSync(gitConfig, "url = https://token@example.com");
    expect((await planReply(`[[send: ${gitConfig}]]`, { home, paseoHome, bridgeFilesDir })).body).toBe(`Could not send ${gitConfig}: it is inside a hidden folder.`);
  });

  it("refuses Paseo's folder when it is reached through a symlink", async () => {
    const { home, bridgeFilesDir } = homes();
    const realPaseoHome = makeTempDir("tg-real-paseo-");
    const settings = join(realPaseoHome, "plugin-settings", "telegram-bridge", "bridge.json");
    mkdirSync(join(settings, ".."), { recursive: true });
    writeFileSync(settings, "token");
    const linkedPaseoHome = join(makeTempDir("tg-link-"), "paseo");
    symlinkSync(realPaseoHome, linkedPaseoHome);
    const reply = `[[send: ${join(linkedPaseoHome, "plugin-settings", "telegram-bridge", "bridge.json")}]]`;
    expect((await planReply(reply, { home, paseoHome: linkedPaseoHome, bridgeFilesDir })).files).toEqual([]);
  });

  it("still sends back a file the chat sent in", async () => {
    const { home, paseoHome, bridgeFilesDir } = homes();
    const received = join(bridgeFilesDir, "-100200", "9-report.pdf");
    mkdirSync(join(received, ".."), { recursive: true });
    writeFileSync(received, "pdf");
    expect((await planReply(`[[send: ${received}]]`, { home, paseoHome, bridgeFilesDir })).files).toEqual([{ path: received, kind: "document" }]);
  });
});
