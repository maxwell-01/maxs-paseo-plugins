import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPaseoCli } from "./paseo-cli.server";

function fakePaseo(body: string) {
  const script = join(mkdtempSync(join(tmpdir(), "cd-cli-")), "paseo.mjs");
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  return createPaseoCli({ command: process.execPath, args: [script] });
}

describe("createPaseoCli", () => {
  it("runs the CLI against the peer's link and returns its output", async () => {
    const cli = fakePaseo("process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const output = await cli.run("https://app.paseo.sh/#offer=bWFj", ["ls", "--json"]);
    expect(JSON.parse(output)).toEqual(["--host", "https://app.paseo.sh/#offer=bWFj", "ls", "--json"]);
  });

  it("does not hand this daemon's password to another daemon", async () => {
    process.env.PASEO_PASSWORD = "local-secret";
    const cli = fakePaseo("process.stdout.write(String(process.env.PASEO_PASSWORD));");
    try {
      await expect(cli.run("https://app.paseo.sh/#offer=bWFj", [])).resolves.toBe("undefined");
    } finally {
      delete process.env.PASEO_PASSWORD;
    }
  });

  it("fails with the CLI's error output", async () => {
    const cli = fakePaseo('process.stderr.write("Agent not found: abc"); process.exit(1);');
    await expect(cli.run("https://app.paseo.sh/#offer=bWFj", ["logs", "abc"])).rejects.toThrow("Agent not found: abc");
  });
});
