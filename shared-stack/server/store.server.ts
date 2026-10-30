import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { emptyState, type QueueState, queueStateSchema } from "./queue.server";

// Files in the shared folder must stay writable by the other accounts in its group.
export const GROUP_FILE = 0o660;
const LOCK_RETRY_MS = 20;
const LOCK_GIVE_UP_MS = 5_000;
// The lock is only held for a read-modify-write; one this old was left by a process that died.
const LOCK_STALE_MS = 10_000;

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeShared(path: string, content: string): void {
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, content, { mode: GROUP_FILE });
  chmodSync(staging, GROUP_FILE);
  renameSync(staging, path);
}

function takeLock(lockPath: string, owner: string): void {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", GROUP_FILE);
      writeSync(fd, `${owner} ${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true });
    } catch {
      // Released between the open and the stat.
    }
    if (Date.now() - startedAt > LOCK_GIVE_UP_MS) {
      throw new Error(`shared-stack: could not lock ${lockPath} within ${LOCK_GIVE_UP_MS / 1000} s`);
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

export function createQueueStore(sharedDir: string, owner: string) {
  const queuePath = join(sharedDir, "queue.json");
  const lockPath = join(sharedDir, "queue.lock");

  const read = (): QueueState => {
    if (!existsSync(queuePath)) return emptyState();
    try {
      return queueStateSchema.parse(JSON.parse(readFileSync(queuePath, "utf8")));
    } catch (error) {
      console.error(`shared-stack: ${queuePath} is unreadable; starting from an empty queue`, error);
      return emptyState();
    }
  };

  return {
    sharedDir,
    read,
    // Synchronous on purpose: the lock is never held across an await.
    update(change: (state: QueueState) => QueueState): QueueState {
      mkdirSync(sharedDir, { recursive: true });
      takeLock(lockPath, owner);
      try {
        const before = read();
        const after = change(before);
        if (after !== before) writeShared(queuePath, `${JSON.stringify(after, null, 2)}\n`);
        return after;
      } finally {
        rmSync(lockPath, { force: true });
      }
    },
  };
}

export type QueueStore = ReturnType<typeof createQueueStore>;
