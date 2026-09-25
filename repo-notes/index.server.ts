import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { resolvePaseoHome } from "./server/paseo-home.server";
import { registerRepoNotes } from "./server/repo-notes.server";

export default function contribute(server: PluginServerContext) {
  return registerRepoNotes(server, { notesDir: resolvePaseoHome().then((home) => join(home, "plugin-data", "repo-notes")) });
}
