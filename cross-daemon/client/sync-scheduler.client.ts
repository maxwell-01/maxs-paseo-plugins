import { type DaemonPort, syncPeers } from "./peer-sync.client";

const SYNC_DEBOUNCE_MS = 1_000;
const RESYNC_INTERVAL_MS = 60_000;

interface SyncScheduler {
  ports: Set<DaemonPort>;
  pending: ReturnType<typeof setTimeout> | null;
  resync: ReturnType<typeof setInterval> | null;
}

declare global {
  var __paseoCrossDaemonScheduler: SyncScheduler | undefined;
}

// Paseo evaluates this bundle once per connected host, so module state is per host. The scheduler
// lives on globalThis so that one sync sees every host.
function scheduler(): SyncScheduler {
  globalThis.__paseoCrossDaemonScheduler ??= { ports: new Set(), pending: null, resync: null };
  return globalThis.__paseoCrossDaemonScheduler;
}

export function requestPeerSync(): void {
  const state = scheduler();
  if (state.pending) clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    void syncPeers([...state.ports]);
  }, SYNC_DEBOUNCE_MS);
}

export function registerDaemon(port: DaemonPort): () => void {
  const state = scheduler();
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
