import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPaseoCli } from "./paseo-cli.server";
import { makeTempDir } from "./temp-dir.test-support";

const peer = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=bWFj" };
const passwordProtectedPeer = { ...peer, password: "mac-password" };

async function withLocalPassword<T>(password: string, use: () => Promise<T>): Promise<T> {
  const saved = process.env.PASEO_PASSWORD;
  process.env.PASEO_PASSWORD = password;
  try {
    return await use();
  } finally {
    if (saved === undefined) delete process.env.PASEO_PASSWORD;
    else process.env.PASEO_PASSWORD = saved;
  }
}

function fakePaseo(body: string, timeoutMs?: number) {
  const script = join(makeTempDir("cd-cli-"), "paseo.mjs");
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  return createPaseoCli({ command: process.execPath, args: [script], home: "/tmp/paseo-home" }, timeoutMs);
}

describe("createPaseoCli", () => {
  it("runs the CLI against the peer's link and returns its output", async () => {
    const cli = fakePaseo("process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const output = await cli.run(peer, ["ls", "--json"]);
    expect(JSON.parse(output)).toEqual(["--host", "https://app.paseo.sh/#offer=bWFj", "ls", "--json"]);
  });

  it("does not hand this daemon's password to another daemon", async () => {
    const cli = fakePaseo("process.stdout.write(String(process.env.PASEO_PASSWORD));");
    await withLocalPassword("local-secret", () => expect(cli.run(peer, [])).resolves.toBe("undefined"));
  });

  it("gives a password-protected peer its own password, never this daemon's", async () => {
    const cli = fakePaseo("process.stdout.write(String(process.env.PASEO_PASSWORD));");
    await withLocalPassword("local-secret", () => expect(cli.run(passwordProtectedPeer, [])).resolves.toBe("mac-password"));
  });

  it("keeps a peer's password out of the arguments", async () => {
    const cli = fakePaseo("process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    expect(await cli.run(passwordProtectedPeer, ["ls"])).not.toContain("mac-password");
  });

  it("says a call timed out when it had to be stopped", async () => {
    const cli = fakePaseo("setTimeout(() => {}, 10_000);", 200);
    await expect(cli.run(peer, [])).rejects.toThrow("timed out after 0.2 s");
  });

  it("fails with the message from the CLI's JSON error", async () => {
    const cli = fakePaseo(
      'process.stderr.write(JSON.stringify({ error: { code: "INSPECT_FAILED", message: "Agent not found: abc" } })); process.exit(1);',
    );
    await expect(cli.run(peer, ["inspect", "abc", "--json"])).rejects.toThrow(/^Agent not found: abc$/);
  });

  it("fails with the CLI's error output", async () => {
    const cli = fakePaseo('process.stderr.write("Agent not found: abc"); process.exit(1);');
    await expect(cli.run(peer, ["logs", "abc"])).rejects.toThrow("Agent not found: abc");
  });
});

describe("prompts passed through a file", () => {
  it("passes the prompt in a file, keeps it out of the arguments, and removes the file afterwards", async () => {
    const cli = fakePaseo(
      'import { readFileSync, existsSync } from "node:fs"; const args = process.argv.slice(2); const file = args[args.indexOf("--prompt-file") + 1]; process.stdout.write(JSON.stringify({ args, text: readFileSync(file, "utf8"), file }));',
    );
    const output = JSON.parse(await cli.run(peer, ["send", "a1"], { promptText: "--home /etc secret plan" }));
    expect(output.text).toBe("--home /etc secret plan");
    expect(output.args.join(" ")).not.toContain("secret plan");
    expect(existsSync(output.file)).toBe(false);
  });

  it("removes the prompt file when the call fails", async () => {
    const cli = fakePaseo(
      'const args = process.argv.slice(2); process.stderr.write(args[args.indexOf("--prompt-file") + 1]); process.exit(1);',
    );
    const error = await cli.run(peer, ["send", "a1"], { promptText: "hi" }).catch((failure: Error) => failure);
    expect(existsSync(String(error instanceof Error ? error.message : ""))).toBe(false);
  });
});
