import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// The CLI gives up connecting after its own 15 s; this bounds the whole command.
const CLI_TIMEOUT_MS = 90_000;
const CLI_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const jsonErrorSchema = z.object({ error: z.object({ message: z.string() }) });

// With --json the CLI reports failures as a JSON object on stderr.
function readCliError(stderr: string): string {
  try {
    const parsed = jsonErrorSchema.safeParse(JSON.parse(stderr));
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // Plain-text output.
  }
  return stderr.trim();
}

export interface PaseoCliCommand {
  command: string;
  args: string[];
  // This daemon's PASEO_HOME, for calls to its own agents.
  home: string;
}

export interface PaseoCliOptions {
  // Passed through a file, so no prompt can be read as an option or overflow the argument list.
  promptText?: string;
}

export interface PaseoCli {
  run(link: string, args: readonly string[], options?: PaseoCliOptions): Promise<string>;
  runLocal(args: readonly string[], options?: PaseoCliOptions): Promise<string>;
}

async function withPromptFile<T>(promptText: string | undefined, use: (extraArgs: string[]) => Promise<T>): Promise<T> {
  if (promptText === undefined) return use([]);
  const dir = mkdtempSync(join(tmpdir(), "cross-daemon-"));
  const file = join(dir, "prompt.txt");
  writeFileSync(file, promptText, { mode: 0o600 });
  try {
    return await use(["--prompt-file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runPaseo(cli: PaseoCliCommand, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number, options?: PaseoCliOptions) {
  return withPromptFile(options?.promptText, (promptArgs) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        cli.command,
        [...cli.args, ...args, ...promptArgs],
        { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: timeoutMs, maxBuffer: CLI_MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error?.killed) reject(new Error(`paseo timed out after ${timeoutMs / 1000} s`));
          else if (error) reject(new Error(readCliError(stderr) || error.message));
          else resolve(stdout.trim());
        },
      );
    }),
  );
}

export function createPaseoCli(cli: PaseoCliCommand, timeoutMs = CLI_TIMEOUT_MS): PaseoCli {
  return {
    run(link, args, options) {
      const env = { ...process.env };
      delete env.PASEO_PASSWORD;
      return runPaseo(cli, ["--host", link, ...args], env, timeoutMs, options);
    },
    runLocal(args, options) {
      return runPaseo(cli, ["--home", cli.home, ...args], process.env, timeoutMs, options);
    },
  };
}
