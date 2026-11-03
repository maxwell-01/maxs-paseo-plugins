import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDaemonSecretKey } from "./daemon-secret-key.server";
import { makeTempDir } from "./temp-dir.test-support";

describe("daemon secret key", () => {
  it("reads the secret key from the keypair file Paseo writes", () => {
    const home = makeTempDir("cd-home-");
    const secretKey = randomBytes(32);
    writeFileSync(
      join(home, "daemon-keypair.json"),
      JSON.stringify({ v: 2, publicKeyB64: randomBytes(32).toString("base64"), secretKeyB64: secretKey.toString("base64") }),
    );
    expect(readDaemonSecretKey(home)).toEqual(secretKey);
  });

  it("fails, naming the file, when Paseo has no keypair", () => {
    const home = join(makeTempDir("cd-home-"), "empty");
    mkdirSync(home);
    expect(() => readDaemonSecretKey(home)).toThrow(/daemon-keypair\.json/);
  });
});
