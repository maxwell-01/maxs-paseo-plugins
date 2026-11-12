import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuard } from "./guard-run.server";
import { makeTempDir } from "./temp-dir.test-support";

function fakeGuard(body: string) {
  const guard = join(makeTempDir("usage-pacer-guard-"), "guard.py");
  writeFileSync(guard, `import os, sys, time\n${body}\n`);
  chmodSync(guard, 0o755);
  return { guard };
}

describe("runGuard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("runs the guard once in its enforce-only mode", async () => {
    const dir = makeTempDir("usage-pacer-seen-");
    const seen = join(dir, "seen");
    const { guard } = fakeGuard(
      `open(${JSON.stringify(seen)}, 'w').write(' '.join(sys.argv[1:]))`,
    );
    const log = vi.fn();
    await runGuard({ guard, mode: "bootstrap", log });
    expect(readFileSync(seen, "utf8")).toBe("--bootstrap");
    expect(log).not.toHaveBeenCalled();
  });

  it("runs the watch with no flag and logs each line it prints, with the environment it was started in", async () => {
    const { guard } = fakeGuard("print('Subscription pace alert: one')\nprint()\nprint('- two ' + os.environ['STATE'] + ' ' + str(len(sys.argv)))");
    vi.stubEnv("STATE", "/s");
    const log = vi.fn();
    await runGuard({ guard, mode: "watch", log });
    expect(log.mock.calls).toEqual([["Subscription pace alert: one"], ["- two /s 1"]]);
  });

  it("in watch mode, stays quiet about a nonzero exit that printed nothing to stderr", async () => {
    const { guard } = fakeGuard("sys.exit(1)");
    const log = vi.fn();
    await runGuard({ guard, mode: "watch", log });
    expect(log).not.toHaveBeenCalled();
  });

  it("in watch mode, logs a nonzero exit that printed to stderr", async () => {
    const { guard } = fakeGuard("print('boom', file=sys.stderr)\nsys.exit(1)");
    const log = vi.fn();
    await runGuard({ guard, mode: "watch", log });
    expect(log).toHaveBeenCalledWith("usage-pacer: the usage guard exited 1: boom");
  });

  it("logs a line whole when it arrives in two chunks", async () => {
    const { guard } = fakeGuard("sys.stdout.write('hel'); sys.stdout.flush(); time.sleep(0.2); print('lo')");
    const log = vi.fn();
    await runGuard({ guard, mode: "watch", log });
    expect(log.mock.calls).toEqual([["hello"]]);
  });

  it("logs a failed run with the end of its stderr", async () => {
    const { guard } = fakeGuard("print('Managed agent interruption failed', file=sys.stderr)\nsys.exit(1)");
    const log = vi.fn();
    await runGuard({ guard, mode: "bootstrap", log });
    expect(log).toHaveBeenCalledWith("usage-pacer: the usage guard exited 1: Managed agent interruption failed");
  });

  it("ends a hung run with SIGTERM and logs it", async () => {
    const { guard } = fakeGuard("time.sleep(30)");
    const log = vi.fn();
    await runGuard({ guard, mode: "bootstrap", log, timeoutMs: 200 });
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
    await runGuard({ guard, mode: "bootstrap", log, timeoutMs: 300, killGraceMs: 200 });
    expect(Date.now() - started).toBeLessThan(2_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });

  it("logs a guard that cannot start, without throwing", async () => {
    const log = vi.fn();
    await runGuard({ guard: "/no/such/guard.py", mode: "bootstrap", log, python: "/no/such/python3" });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^usage-pacer: the usage guard did not start: /));
  });
});
