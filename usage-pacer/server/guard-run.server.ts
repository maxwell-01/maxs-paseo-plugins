import { spawn } from "node:child_process";

// Longer than the guard's own worst case: two usage reads and its 100 s stop deadline.
const GUARD_TIMEOUT_MS = 150_000;
const KILL_GRACE_MS = 5_000;
const STDERR_TAIL_CHARS = 500;

export interface GuardRun {
  guard: string;
  firstMateHome: string;
  log: (line: string) => void;
  python?: string;
  timeoutMs?: number;
  killGraceMs?: number;
}

export function runGuard({
  guard,
  firstMateHome,
  log,
  python = "python3",
  timeoutMs = GUARD_TIMEOUT_MS,
  killGraceMs = KILL_GRACE_MS,
}: GuardRun) {
  return new Promise<void>((resolve) => {
    const child = spawn(python, [guard, "--bootstrap"], {
      env: { ...process.env, FIRSTMATE_HOME: firstMateHome },
      stdio: ["ignore", "ignore", "pipe"],
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
