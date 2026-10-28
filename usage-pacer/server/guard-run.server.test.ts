import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runGuard } from "./guard-run.server";
import { makeTempDir } from "./temp-dir.test-support";

function fakeGuard(body: string) {
  const guard = join(makeTempDir("usage-pacer-guard-"), "guard.py");
  writeFileSync(guard, `import os, sys, time\n${body}\n`);
  chmodSync(guard, 0o755);
  return { guard };
}

describe("runGuard", () => {
  it("runs the guard once in its enforce-only mode, against the first mate home", async () => {
    const dir = makeTempDir("usage-pacer-seen-");
    const seen = join(dir, "seen");
    const { guard } = fakeGuard(
      `open(${JSON.stringify(seen)}, 'w').write(' '.join(sys.argv[1:]) + '|' + os.environ['FIRSTMATE_HOME'])`,
    );
    const log = vi.fn();
    await runGuard({ guard, firstMateHome: "/fm/home", log });
    expect(readFileSync(seen, "utf8")).toBe("--bootstrap|/fm/home");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a failed run with the end of its stderr", async () => {
    const { guard } = fakeGuard("print('Managed crew interruption failed', file=sys.stderr)\nsys.exit(1)");
    const log = vi.fn();
    await runGuard({ guard, firstMateHome: "/fm/home", log });
    expect(log).toHaveBeenCalledWith("usage-pacer: the usage guard exited 1: Managed crew interruption failed");
  });

  it("ends a hung run with SIGTERM and logs it", async () => {
    const { guard } = fakeGuard("time.sleep(30)");
    const log = vi.fn();
    await runGuard({ guard, firstMateHome: "/fm/home", log, timeoutMs: 200 });
    expect(log).toHaveBeenCalledWith("usage-pacer: the usage guard ran past 200 ms and was ended");
  });

  it("kills a hung run that ignores SIGTERM, and is free again at once", async () => {
    const dir = makeTempDir("usage-pacer-pid-");
    const pidFile = join(dir, "pid");
    const { guard } = fakeGuard(
      `import signal\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nopen(${JSON.stringify(pidFile)}, 'w').write(str(os.getpid()))\ntime.sleep(30)`,
    );
    const log = vi.fn();
    const started = Date.now();
    await runGuard({ guard, firstMateHome: "/fm/home", log, timeoutMs: 300, killGraceMs: 200 });
    expect(Date.now() - started).toBeLessThan(2_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });

  it("logs a guard that cannot start, without throwing", async () => {
    const log = vi.fn();
    await runGuard({ guard: "/no/such/guard.py", firstMateHome: "/fm/home", log, python: "/no/such/python3" });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^usage-pacer: the usage guard did not start: /));
  });
});
