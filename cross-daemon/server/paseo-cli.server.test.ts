import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPaseoCli } from "./paseo-cli.server";

function fakePaseo(body: string, timeoutMs?: number) {
  const script = join(mkdtempSync(join(tmpdir(), "cd-cli-")), "paseo.mjs");
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  return createPaseoCli({ command: process.execPath, args: [script] }, timeoutMs);
}

describe("createPaseoCli", () => {
  it("runs the CLI against the peer's link and returns its output", async () => {
    const cli = fakePaseo("process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const output = await cli.run("https://app.paseo.sh/#offer=bWFj", ["ls", "--json"]);
    expect(JSON.parse(output)).toEqual(["--host", "https://app.paseo.sh/#offer=bWFj", "ls", "--json"]);
  });

  it("does not hand this daemon's password to another daemon", async () => {
    const saved = process.env.PASEO_PASSWORD;
    process.env.PASEO_PASSWORD = "local-secret";
    const cli = fakePaseo("process.stdout.write(String(process.env.PASEO_PASSWORD));");
    try {
      await expect(cli.run("https://app.paseo.sh/#offer=bWFj", [])).resolves.toBe("undefined");
    } finally {
      if (saved === undefined) delete process.env.PASEO_PASSWORD;
      else process.env.PASEO_PASSWORD = saved;
    }
  });

  it("says a call timed out when it had to be stopped", async () => {
    const cli = fakePaseo("setTimeout(() => {}, 10_000);", 200);
    await expect(cli.run("https://app.paseo.sh/#offer=bWFj", [])).rejects.toThrow("timed out after 0.2 s");
  });

  it("fails with the message from the CLI's JSON error", async () => {
    const cli = fakePaseo(
      'process.stderr.write(JSON.stringify({ error: { code: "INSPECT_FAILED", message: "Agent not found: abc" } })); process.exit(1);',
    );
    await expect(cli.run("https://app.paseo.sh/#offer=bWFj", ["inspect", "abc", "--json"])).rejects.toThrow(/^Agent not found: abc$/);
  });

  it("fails with the CLI's error output", async () => {
    const cli = fakePaseo('process.stderr.write("Agent not found: abc"); process.exit(1);');
    await expect(cli.run("https://app.paseo.sh/#offer=bWFj", ["logs", "abc"])).rejects.toThrow("Agent not found: abc");
  });
});
