import { execFile } from "node:child_process";

// The CLI gives up connecting after its own 15 s; this bounds the whole command.
const CLI_TIMEOUT_MS = 90_000;
const CLI_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface PaseoCliCommand {
  command: string;
  args: string[];
}

export interface PaseoCli {
  run(link: string, args: readonly string[]): Promise<string>;
}

export function createPaseoCli(cli: PaseoCliCommand, timeoutMs = CLI_TIMEOUT_MS): PaseoCli {
  return {
    run(link, args) {
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
      delete env.PASEO_PASSWORD;
      return new Promise((resolve, reject) => {
        execFile(
          cli.command,
          [...cli.args, "--host", link, ...args],
          { env, timeout: timeoutMs, maxBuffer: CLI_MAX_OUTPUT_BYTES },
          (error, stdout, stderr) => {
            if (error?.killed) reject(new Error(`paseo timed out after ${timeoutMs / 1000} s`));
            else if (error) reject(new Error(stderr.trim() || error.message));
            else resolve(stdout.trim());
          },
        );
      });
    },
  };
}
