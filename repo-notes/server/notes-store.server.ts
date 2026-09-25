import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { MAX_NOTES_BYTES, repoKeySchema } from "../shared/repo-notes.shared";

export function resolveNotesFile(notesDir: string, key: string): string {
  return join(notesDir, "repos", ...repoKeySchema.parse(key).split("/"), "AGENTS.md");
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

export async function readNotes(file: string): Promise<string> {
  try {
    const { size } = await stat(file);
    if (size > MAX_NOTES_BYTES) throw new Error(`${file} is ${size} bytes; notes are limited to ${MAX_NOTES_BYTES}`);
    return await readFile(file, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return "";
    throw error;
  }
}
