import { type DaemonPort, syncRepoNotes } from "./notes-sync.client";

const SYNC_DEBOUNCE_MS = 1_000;
const RESYNC_INTERVAL_MS = 60_000;

interface SyncScheduler {
  ports: Set<DaemonPort>;
  pending: ReturnType<typeof setTimeout> | null;
  resync: ReturnType<typeof setInterval> | null;
  running: boolean;
  rerunRequested: boolean;
}

declare global {
  var __paseoRepoNotesSchedulerV1: SyncScheduler | undefined;
}

// Paseo evaluates this bundle once per connected host, so module state is per host. The scheduler
// lives on globalThis so that one sync sees every host.
function getSharedScheduler(): SyncScheduler {
  globalThis.__paseoRepoNotesSchedulerV1 ??= {
    ports: new Set(),
    pending: null,
    resync: null,
    running: false,
    rerunRequested: false,
  };
  return globalThis.__paseoRepoNotesSchedulerV1;
}

async function runSync(state: SyncScheduler): Promise<void> {
  if (state.running) {
    state.rerunRequested = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.rerunRequested = false;
      await syncRepoNotes([...state.ports]);
    } while (state.rerunRequested);
  } finally {
    state.running = false;
  }
}

function requestNotesSync(): void {
  const state = getSharedScheduler();
  if (state.pending) clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    void runSync(state);
  }, SYNC_DEBOUNCE_MS);
}

export function registerDaemon(port: DaemonPort): () => void {
  const state = getSharedScheduler();
  state.ports.add(port);
  state.resync ??= setInterval(requestNotesSync, RESYNC_INTERVAL_MS);
  requestNotesSync();
  return () => {
    state.ports.delete(port);
    if (state.ports.size > 0) return;
    if (state.resync) clearInterval(state.resync);
    if (state.pending) clearTimeout(state.pending);
    state.resync = null;
    state.pending = null;
  };
}
