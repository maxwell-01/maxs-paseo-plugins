import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import type { z } from "zod";
import { MAX_NOTES_BYTES, type NotesVersion, repoKeySchema, writeRepoNotes } from "../shared/repo-notes.shared";

const NOTES_FILE_NAME = "AGENTS.md";

type NotesWrite = z.output<typeof writeRepoNotes.input>;

export function resolveNotesFile(notesDir: string, key: string): string {
  return join(notesDir, "repos", ...repoKeySchema.parse(key).split("/"), NOTES_FILE_NAME);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

const hashNotes = (content: string) => createHash("sha256").update(content).digest("hex");

// One open handle, so the time and the text come from the same version of the file.
async function readUnlimited(file: string): Promise<{ content: string; bytes: number; modifiedAt: number } | null> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  try {
    const [stats, buffer] = await Promise.all([handle.stat(), handle.readFile()]);
    return { content: buffer.toString("utf8"), bytes: buffer.length, modifiedAt: Math.round(stats.mtimeMs) };
  } finally {
    await handle.close();
  }
}

export async function readNotesFile(file: string): Promise<{ content: string; hash: string; modifiedAt: number } | null> {
  const notes = await readUnlimited(file);
  if (!notes) return null;
  if (notes.bytes > MAX_NOTES_BYTES) throw new Error(`${file} is ${notes.bytes} bytes; notes are limited to ${MAX_NOTES_BYTES}`);
  return { content: notes.content, hash: hashNotes(notes.content), modifiedAt: notes.modifiedAt };
}

async function listNotesKeys(notesDir: string): Promise<string[]> {
  try {
    const paths = await readdir(join(notesDir, "repos"), { recursive: true });
    return paths
      .filter((path) => basename(path) === NOTES_FILE_NAME)
      .map((path) => dirname(path).split(sep).join("/"))
      .filter((key) => repoKeySchema.safeParse(key).success);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

export async function listNotes(notesDir: string): Promise<NotesVersion[]> {
  const keys = await listNotesKeys(notesDir);
  const reads = await Promise.allSettled(keys.map((key) => readNotesFile(resolveNotesFile(notesDir, key))));
  return reads.flatMap((read, index) => {
    const key = keys[index];
    if (read.status === "rejected") {
      console.error(`repo-notes: left ${key} out of the sync`, read.reason);
      return [];
    }
    return read.value ? [{ key, hash: read.value.hash, modifiedAt: read.value.modifiedAt }] : [];
  });
}

const writesInFlight = new Map<string, Promise<unknown>>();

async function writeOneAtATime<Result>(key: string, write: () => Promise<Result>): Promise<Result> {
  const previous = writesInFlight.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  writesInFlight.set(key, next);
  try {
    return await next;
  } finally {
    if (writesInFlight.get(key) === next) writesInFlight.delete(key);
  }
}

export async function writeNotes(notesDir: string, { key, content, modifiedAt, expectedHash }: NotesWrite): Promise<boolean> {
  return writeOneAtATime(key, async () => {
    const file = resolveNotesFile(notesDir, key);
    const current = await readUnlimited(file);
    if ((current ? hashNotes(current.content) : null) !== expectedHash) return false;
    if (current?.content === content) return true;
    await mkdir(dirname(file), { recursive: true });
    if (current) await writeFile(`${file}.replaced`, current.content);
    const staging = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(staging, content, { flag: "wx", flush: true });
      await utimes(staging, new Date(modifiedAt), new Date(modifiedAt));
      await rename(staging, file);
    } finally {
      await rm(staging, { force: true });
    }
    return true;
  });
}
