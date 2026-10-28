// Paseo caches usage for five minutes, so a guard run more often than this only recounts agents.
export const MIN_GAP_MS = 30_000;

export interface Pacer {
  poke(): void;
  stop(): void;
}

export function createPacer(run: () => Promise<void>): Pacer {
  let running = false;
  let pending = false;
  let stopped = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    timer = undefined;
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      pending = false;
      timer = setTimeout(start, wait);
      return;
    }
    running = true;
    pending = false;
    lastStart = Date.now();
    void run()
      .catch((error: unknown) => console.error("usage-pacer: a guard run failed", error))
      .finally(() => {
        running = false;
        if (pending) start();
      });
  };

  return {
    poke: () => {
      if (timer === undefined) start();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
