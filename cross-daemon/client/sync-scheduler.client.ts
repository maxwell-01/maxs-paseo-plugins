import { type DaemonPort, syncPeers } from "./peer-sync.client";

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
  var __paseoCrossDaemonSchedulerV1: SyncScheduler | undefined;
}

// Paseo evaluates this bundle once per connected host, so module state is per host. The scheduler
// lives on globalThis so that one sync sees every host.
function getSharedScheduler(): SyncScheduler {
  globalThis.__paseoCrossDaemonSchedulerV1 ??= {
    ports: new Set(),
    pending: null,
    resync: null,
    running: false,
    rerunRequested: false,
  };
  return globalThis.__paseoCrossDaemonSchedulerV1;
}

// One sync at a time: an older sync finishing late would otherwise restore a link a newer one removed.
async function runSync(state: SyncScheduler): Promise<void> {
  if (state.running) {
    state.rerunRequested = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.rerunRequested = false;
      await syncPeers([...state.ports]);
    } while (state.rerunRequested);
  } finally {
    state.running = false;
  }
}

export function requestPeerSync(): void {
  const state = getSharedScheduler();
  if (state.pending) clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    void runSync(state);
  }, SYNC_DEBOUNCE_MS);
}

export function listRegisteredDaemons(): DaemonPort[] {
  return [...getSharedScheduler().ports];
}

export function registerDaemon(port: DaemonPort): () => void {
  const state = getSharedScheduler();
  state.ports.add(port);
  state.resync ??= setInterval(requestPeerSync, RESYNC_INTERVAL_MS);
  requestPeerSync();
  return () => {
    state.ports.delete(port);
    if (state.ports.size > 0) return;
    if (state.resync) clearInterval(state.resync);
    if (state.pending) clearTimeout(state.pending);
    state.resync = null;
    state.pending = null;
  };
}
