import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRepoNotes, readRepoNotes, writeRepoNotes } from "../shared/repo-notes.shared";
import { withoutRepoNotes, withRepoNotes } from "./notes-prompt.server";
import { listNotes, readNotesFile, resolveNotesFile, writeNotes } from "./notes-store.server";
import { readRepoKey } from "./repo-key.server";

interface RepoNotesDependencies {
  notesDir: Promise<string>;
}

export function registerRepoNotes(server: PluginServerContext, { notesDir }: RepoNotesDependencies) {
  notesDir.catch((error: unknown) => console.error("repo-notes: could not find the notes folder", error));

  server.handle(listRepoNotes, async () => ({ notes: await listNotes(await notesDir) }));

  server.handle(readRepoNotes, async ({ key }) => ({ notes: await readNotesFile(resolveNotesFile(await notesDir, key)) }));

  server.handle(writeRepoNotes, async (write) => ({ written: await writeNotes(await notesDir, write) }));

  return server.before("agent.create", async ({ request }) => {
    try {
      const key = await readRepoKey(request.config.cwd);
      if (!key) return { ...request, config: withoutRepoNotes(request.config) };
      const path = resolveNotesFile(await notesDir, key);
      return { ...request, config: withRepoNotes(request.config, { key, path, notes: (await readNotesFile(path))?.content ?? "" }) };
    } catch (error) {
      console.error("repo-notes: gave a new agent no notes", error);
      return request;
    }
  });
}
