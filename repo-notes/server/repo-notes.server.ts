import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withRepoNotes } from "./notes-prompt.server";
import { readNotes, resolveNotesFile } from "./notes-store.server";
import { readRepoKey } from "./repo-key.server";

interface RepoNotesDependencies {
  notesDir: Promise<string>;
}

export function registerRepoNotes(server: PluginServerContext, { notesDir }: RepoNotesDependencies) {
  notesDir.catch((error: unknown) => console.error("repo-notes: could not find the notes folder", error));

  return server.before("agent.create", async ({ request }) => {
    try {
      const key = await readRepoKey(request.config.cwd);
      if (!key) return request;
      const path = resolveNotesFile(await notesDir, key);
      return { ...request, config: withRepoNotes(request.config, { key, path, notes: readNotes(path) }) };
    } catch (error) {
      console.error("repo-notes: gave a new agent no notes", error);
      return request;
    }
  });
}
