import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { z } from "zod";
import type { Config } from "./config.server";
import {
  applySnapshot,
  currentBranch,
  ensureSharedRepo,
  forgetSnapshotIndex,
  hasOriginal,
  publishSnapshot,
  restoreOriginal,
} from "./git-sync.server";
import { type Caller, describeEntry, type Holder, join as joinQueue, leave, placeOf, type QueueState, recordSnapshot, renew, sameAgent, tick } from "./queue.server";
import { createQueueStore, writeShared } from "./store.server";

const TICK_MS = 2_000;
// Asking Paseo whether this daemon's queued agents still exist is slower, so it runs less often.
const LIVENESS_EVERY_TICKS = 15;

const hostStatusSchema = z.object({
  daemon: z.string(),
  heartbeatAt: z.string(),
  stackUrl: z.string().nullable(),
  applied: z.object({ daemon: z.string(), agentId: z.string(), commit: z.string(), at: z.string() }).nullable(),
  error: z.string().nullable(),
});
export type HostStatus = z.infer<typeof hostStatusSchema>;

export interface Who {
  daemon: string;
  agentId: string;
}

export function createEngine(options: { config: Config; daemon: string; dataDir: string; paseo: () => PaseoApi | null }) {
  const { config, daemon, dataDir } = options;
  const store = createQueueStore(config.sharedDir, daemon);
  const hostPath = join(config.sharedDir, "host.json");
  const isHost = config.stackCheckout !== undefined;
  const waitingInJoin = new Set<string>();
  const notifiedGrants = new Set<string>();
  let lastError: string | null = null;
  let ticks = 0;
  let running = false;
  let hostApplied: HostStatus["applied"] = null;
  let hostError: string | null = null;
  let repoReady = false;

  const snapshotIndex = (agentId: string) => join(dataDir, `index-${agentId}`);
  const grantKey = (holder: Holder) => `${holder.agentId}@${holder.grantedAt}`;

  function readHost(): HostStatus | null {
    try {
      return existsSync(hostPath) ? hostStatusSchema.parse(JSON.parse(readFileSync(hostPath, "utf8"))) : null;
    } catch {
      return null;
    }
  }

  async function publishForHolder(holder: Holder): Promise<void> {
    if (holder.daemon !== daemon) return;
    const published = await publishSnapshot({
      workspaceDir: holder.workspaceDir,
      indexPath: snapshotIndex(holder.agentId),
      sharedDir: config.sharedDir,
      lastTree: holder.snapshot?.tree ?? null,
    });
    if (published) store.update((state) => recordSnapshot(state, holder, published, Date.now()));
  }

  async function tellNewHolder(holder: Holder, stackUrl: string | null): Promise<void> {
    if (holder.daemon !== daemon || notifiedGrants.has(grantKey(holder))) return;
    const paseo = options.paseo();
    if (!paseo) return;
    notifiedGrants.add(grantKey(holder));
    if (waitingInJoin.has(holder.agentId)) return;
    const where = stackUrl ? ` at ${stackUrl}` : "";
    await paseo.agents
      .ref(holder.agentId)
      .send(
        `[shared-stack] You now hold the shared stack${where}. Your working tree is being synced onto it. ` +
          "Test what you queued for, then call stack_release. Your hold runs out after 30 minutes without a stack tool call or a file change.",
      );
  }

  // Drops this daemon's entries whose agent or workspace has gone.
  async function dropGoneAgents(state: QueueState): Promise<void> {
    const paseo = options.paseo();
    if (!paseo) return;
    const mine = [...(state.holder ? [state.holder] : []), ...state.waiting].filter((entry) => entry.daemon === daemon);
    for (const entry of mine) {
      const found = await paseo.agents.ref(entry.agentId).refresh().catch(() => undefined);
      if (found === undefined) continue;
      const gone = !found || found.agent.archivedAt ? "its agent was archived" : !existsSync(entry.workspaceDir) ? "its workspace directory is gone" : null;
      if (gone) forget(entry, gone);
    }
  }

  async function hostTick(state: QueueState): Promise<void> {
    const checkout = config.stackCheckout;
    if (!checkout) return;
    try {
      if (!repoReady) {
        await ensureSharedRepo(config.sharedDir, checkout);
        repoReady = true;
      }
      const holder = state.holder;
      if (holder?.snapshot && hostApplied?.commit !== holder.snapshot.commit) {
        await applySnapshot({ checkout, sharedDir: config.sharedDir, commit: holder.snapshot.commit, indexPath: join(dataDir, "index-original") });
        hostApplied = { daemon: holder.daemon, agentId: holder.agentId, commit: holder.snapshot.commit, at: new Date().toISOString() };
      } else if (!holder && (hostApplied || (await hasOriginal(checkout)))) {
        await restoreOriginal(checkout);
        hostApplied = null;
      }
      hostError = null;
    } catch (error) {
      hostError = error instanceof Error ? error.message : String(error);
    }
    const status: HostStatus = { daemon, heartbeatAt: new Date().toISOString(), stackUrl: config.stackUrl ?? null, applied: hostApplied, error: hostError };
    writeShared(hostPath, `${JSON.stringify(status, null, 2)}\n`);
  }

  async function runTick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const state = store.update((current) => tick(current, daemon, Date.now()));
      if ((ticks++ % LIVENESS_EVERY_TICKS) === 0) await dropGoneAgents(state);
      const latest = store.read();
      if (latest.holder) {
        await publishForHolder(latest.holder);
        await tellNewHolder(latest.holder, readHost()?.stackUrl ?? null);
      }
      if (isHost) await hostTick(store.read());
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("shared-stack: tick failed", error);
    } finally {
      running = false;
    }
  }

  function forget(who: Who, reason: string): QueueState {
    forgetSnapshotIndex(snapshotIndex(who.agentId));
    return store.update((state) => leave(state, who, Date.now(), reason));
  }

  const timer = setInterval(() => void runTick(), TICK_MS);
  void runTick();

  return {
    daemon,
    isHost,
    config,
    read: () => store.read(),
    readHost,
    lastError: () => lastError,
    async callerFor(agentId: string): Promise<Caller> {
      const paseo = options.paseo();
      if (!paseo) throw new Error("shared-stack has not reached Paseo since it started; try again in a moment");
      const found = await paseo.agents.ref(agentId).refresh();
      if (!found) throw new Error(`agent ${agentId} is not known to this daemon`);
      const { agent } = found;
      const workspace = agent.workspaceId ? await paseo.workspaces.ref(agent.workspaceId).refresh() : null;
      const workspaceDir = workspace?.workspaceDirectory || agent.cwd;
      return {
        daemon,
        agentId,
        agentTitle: agent.title ?? null,
        workspaceId: agent.workspaceId ?? null,
        workspaceName: workspace?.name ?? workspaceDir,
        workspaceDir,
        branch: await currentBranch(workspaceDir),
      };
    },
    join(caller: Caller): QueueState {
      const state = store.update((current) => joinQueue(current, caller, Date.now()));
      void runTick();
      return state;
    },
    renew(who: Who): QueueState {
      return store.update((state) => renew(state, who, Date.now()));
    },
    leave(who: Who, reason: string): QueueState {
      const state = forget(who, reason);
      void runTick();
      return state;
    },
    placeOf,
    sameAgent,
    describeEntry,
    // Lets a waiting stack_join call stop the daemon from also messaging the agent.
    waiting(agentId: string, inside: boolean) {
      if (inside) waitingInJoin.add(agentId);
      else waitingInJoin.delete(agentId);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
