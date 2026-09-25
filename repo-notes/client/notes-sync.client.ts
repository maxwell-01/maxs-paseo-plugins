import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { listRepoNotes, type NotesVersion, readRepoNotes, writeRepoNotes } from "../shared/repo-notes.shared";

type Notes = NonNullable<z.output<typeof readRepoNotes.output>["notes"]>;
export type NotesWrite = z.input<typeof writeRepoNotes.input>;

const LIST_TIMEOUT_MS = 10_000;

export interface DaemonPort {
  list(): Promise<NotesVersion[]>;
  read(key: string): Promise<Notes | null>;
  write(write: NotesWrite): Promise<boolean>;
}

export function createDaemonPort(rpc: PluginClientContext["rpc"]): DaemonPort {
  return {
    list: async () => (await rpc(listRepoNotes, {})).notes,
    read: async (key) => (await rpc(readRepoNotes, { key })).notes,
    write: async (write) => (await rpc(writeRepoNotes, write)).written,
  };
}

interface ListedDaemon {
  port: DaemonPort;
  versions: Map<string, NotesVersion>;
}

const isNewer = (a: NotesVersion, b: NotesVersion) => a.modifiedAt > b.modifiedAt || (a.modifiedAt === b.modifiedAt && a.hash > b.hash);

async function syncOneRepo(key: string, daemons: readonly ListedDaemon[]): Promise<void> {
  const listed = daemons.map((daemon) => ({ port: daemon.port, version: daemon.versions.get(key) ?? null }));
  const newest = listed.reduce<{ port: DaemonPort; version: NotesVersion } | null>(
    (best, entry) => (entry.version && (!best || isNewer(entry.version, best.version)) ? { port: entry.port, version: entry.version } : best),
    null,
  );
  if (!newest) return;
  const behind = listed.filter((entry) => entry.version?.hash !== newest.version.hash);
  if (behind.length === 0) return;

  const notes = await newest.port.read(key);
  if (notes?.hash !== newest.version.hash) return;
  const writes = await Promise.allSettled(
    behind.map((entry) => entry.port.write({ key, content: notes.content, modifiedAt: notes.modifiedAt, expectedHash: entry.version?.hash ?? null })),
  );
  for (const write of writes) {
    if (write.status === "rejected") console.warn(`repo-notes: could not send the notes for ${key} to a host`, write.reason);
    else if (!write.value) console.warn(`repo-notes: a host kept its own notes for ${key}; they changed after the sync listed them`);
  }
}

function listWithin(port: DaemonPort, ms: number): Promise<NotesVersion[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([port.list(), timeout]).finally(() => clearTimeout(timer));
}

export async function syncRepoNotes(ports: readonly DaemonPort[]): Promise<void> {
  const lists = await Promise.allSettled(ports.map((port) => listWithin(port, LIST_TIMEOUT_MS)));
  const daemons = lists.flatMap((list, index): ListedDaemon[] => {
    if (list.status === "fulfilled") return [{ port: ports[index], versions: new Map(list.value.map((version) => [version.key, version])) }];
    console.warn("repo-notes: could not list the notes on a host", list.reason);
    return [];
  });
  const keys = [...new Set(daemons.flatMap((daemon) => [...daemon.versions.keys()]))];
  const syncs = await Promise.allSettled(keys.map((key) => syncOneRepo(key, daemons)));
  syncs.forEach((sync, index) => {
    if (sync.status === "rejected") console.warn(`repo-notes: could not sync the notes for ${keys[index]}`, sync.reason);
  });
}
