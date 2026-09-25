import type { PluginBeforeRequests } from "@getpaseo/plugin/server";

type AgentSessionConfig = PluginBeforeRequests["agent.create"]["config"];

export interface RepoNotes {
  key: string;
  path: string;
  notes: string;
}

function describeNotes({ key, path, notes }: RepoNotes): string {
  const heading = `# Personal notes for ${key}`;
  const keepOut = "Never commit that file or copy its text into the repo.";
  const trimmedNotes = notes.trim();
  if (trimmedNotes === "") {
    return `${heading}\n\nThe user has no notes yet for this repo. When the user asks you to add to their notes for this repo, write them in ${path}. ${keepOut}`;
  }
  return [
    heading,
    `These are the user's own notes on how to work in this repo. They are not part of the repo. Follow them as you follow the repo's AGENTS.md. To change them, edit ${path}. ${keepOut}`,
    trimmedNotes,
  ].join("\n\n");
}

const SECTION_START = "<repo-notes>";
const SECTION_END = "</repo-notes>";
const NOTES_SECTION = /\s*<repo-notes>[\s\S]*?<\/repo-notes>/g;

// Paseo copies a parent agent's system prompt into its child agents and schedules, so a prompt can
// arrive with notes already in it.
export function withoutRepoNotes(config: AgentSessionConfig): AgentSessionConfig {
  if (!config.systemPrompt?.includes(SECTION_START)) return config;
  const ownPrompt = config.systemPrompt.replace(NOTES_SECTION, "").trim();
  const { systemPrompt: _inherited, ...rest } = config;
  return ownPrompt === "" ? rest : { ...rest, systemPrompt: ownPrompt };
}

export function withRepoNotes(config: AgentSessionConfig, repo: RepoNotes): AgentSessionConfig {
  const section = `${SECTION_START}\n${describeNotes(repo)}\n${SECTION_END}`;
  const { systemPrompt } = withoutRepoNotes(config);
  return { ...config, systemPrompt: systemPrompt ? `${systemPrompt}\n\n${section}` : section };
}
