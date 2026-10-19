import { setTimeout as sleepFor } from "node:timers/promises";
import type { OffsetStore } from "./offset-store.server";
import { type TelegramApi, TelegramApiError, type TelegramMessage } from "./telegram-api.server";

const LONG_POLL_SECONDS = 50;
const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 60_000;
const CONFLICT = 409;

interface PollerOptions {
  api: Pick<TelegramApi, "getUpdates">;
  offsets: OffsetStore;
  onMessage(message: TelegramMessage): Promise<void>;
  log(line: string): void;
  signal: AbortSignal;
  retryDelayMs?: (failures: number) => number;
}

const doublingDelay = (failures: number) => Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), LONGEST_RETRY_MS);

function describeFailure(error: unknown, failures: number, retryDelayMs: (failures: number) => number) {
  if (!(error instanceof TelegramApiError)) return { reason: String(error), delayMs: retryDelayMs(failures) };
  const reason = error.status === CONFLICT ? "another program is polling this bot token; only one can" : error.message;
  return { reason, delayMs: error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : retryDelayMs(failures) };
}

async function wait(ms: number, signal: AbortSignal) {
  await sleepFor(ms, undefined, { signal }).catch((error: unknown) => {
    if (!signal.aborted) throw error;
  });
}

export async function runPoller({ api, offsets, onMessage, log, signal, retryDelayMs = doublingDelay }: PollerOptions) {
  let offset = offsets.read();
  let failures = 0;
  let lastReason = "";
  while (!signal.aborted) {
    let updates;
    try {
      updates = await api.getUpdates(offset, LONG_POLL_SECONDS, signal);
      failures = 0;
      lastReason = "";
    } catch (error) {
      if (signal.aborted) return;
      failures += 1;
      const { reason, delayMs } = describeFailure(error, failures, retryDelayMs);
      if (reason !== lastReason) log(`telegram-bridge: ${reason}. Retrying in ${Math.round(delayMs / 1000)} s`);
      lastReason = reason;
      await wait(delayMs, signal);
      continue;
    }
    for (const { updateId, message } of updates) {
      if (signal.aborted) return;
      offset = updateId + 1;
      offsets.write(offset);
      if (message) await onMessage(message).catch((error: unknown) => log(`telegram-bridge: a message was not handled: ${String(error)}`));
    }
  }
}
