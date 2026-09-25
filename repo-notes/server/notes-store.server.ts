import { readFileSync } from "node:fs";
import { join } from "node:path";

export function resolveNotesFile(notesDir: string, key: string): string {
  return join(notesDir, "repos", ...key.split("/"), "AGENTS.md");
}

export function readNotes(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return "";
    throw error;
  }
}
