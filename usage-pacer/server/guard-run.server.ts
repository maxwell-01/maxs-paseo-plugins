import { spawn } from "node:child_process";

// Longer than the guard's own worst case: two usage reads and its 100 s stop deadline.
const GUARD_TIMEOUT_MS = 150_000;
const KILL_GRACE_MS = 5_000;
const STDERR_TAIL_CHARS = 500;

// Only the watch prints to stdout (pace alerts, change notices); every printed line goes to the plugin log.
export type GuardMode = "bootstrap" | "watch";

export interface GuardRun {
  guard: string;
  mode: GuardMode;
  log: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  python?: string;
  timeoutMs?: number;
  killGraceMs?: number;
}

export function runGuard({
  guard,
  mode,
  env,
  log,
  python = "python3",
  timeoutMs = GUARD_TIMEOUT_MS,
  killGraceMs = KILL_GRACE_MS,
}: GuardRun) {
  return new Promise<void>((resolve) => {
    const child = spawn(python, mode === "bootstrap" ? [guard, "--bootstrap"] : [guard], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const settle = (problem?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (problem) log(`usage-pacer: the usage guard ${problem}`);
      resolve();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) log(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });
    // Settle at the timeout, so a guard that ignores SIGTERM cannot hold the pacer's single run slot.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      child.once("exit", () => clearTimeout(kill));
      settle(`ran past ${timeoutMs} ms and was ended`);
    }, timeoutMs);
    child.on("error", (error) => settle(`did not start: ${error.message}`));
    child.on("close", (code) => settle(code === 0 ? undefined : `exited ${code}: ${stderr.trim()}`));
  });
}
