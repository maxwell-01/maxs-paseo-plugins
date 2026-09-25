# Repo notes

A [Paseo](https://paseo.sh) plugin that gives every new agent your own notes for its repo: how you
like to work there, kept out of the repo and the same on every daemon. Requires **Paseo 0.9.2 or
newer**, installed on every daemon that shares notes.

## Where the notes are

Each daemon keeps one file per repo:

```
$PASEO_HOME/plugin-data/repo-notes/repos/<host>/<owner>/<repo>/AGENTS.md
```

A repo is known by its `origin` remote, so `git@github.com:maxwell-01/myStuff.git` and
`https://github.com/maxwell-01/myStuff` both use `repos/github.com/maxwell-01/mystuff/AGENTS.md`.
The key is in lower case, because GitHub ignores case. Every clone and worktree of a repo shares its notes.
A remote that uses an SSH alias, such as `gh-work:owner/repo`, gets its own key under that alias.

Write the file yourself, or ask an agent: "add to my notes for this repo: ...". The file is never
committed anywhere. Keep it a plain file: a symlink is replaced by a copy when notes arrive from
another daemon.

Before notes from another daemon replace yours, your old text is kept beside them as
`AGENTS.md.replaced`. There is one such copy per repo. To go back to it, copy its text into
`AGENTS.md` and save; renaming the file keeps its old time, so the next sync would replace it again.

## What an agent gets

A new Claude, Codex or OpenCode agent gets the notes for its folder's repo, and the path of the notes
file, at the end of its system prompt. If the repo has no notes yet, it gets only the path, so it
knows where to write them.

An agent keeps the notes it was created with. After an edit, only new agents see the change. A child
agent or schedule that copies another agent's prompt gets its own repo's notes in place of the copied ones.

A notes file larger than 100 KB is not given to agents; the plugin logs it.

An agent in a folder with no `origin` remote gets nothing. If the plugin fails, the agent still
starts, without notes, and the fault is in `paseo plugin logs repo-notes`.

## Sync between daemons

While the app is open, it syncs every host that has the plugin: at connect and every minute. For
each repo, the most recently changed notes, by each daemon's own clock, win and go to every other
daemon, with their change time. If two daemons have the same change time, the same one wins
everywhere.

The app is the only party that can reach every daemon, so notes move only while it is open. A
daemon that does not answer in 10 seconds, for example a sleeping Mac, is left out and catches up
at a later sync.

A sync never overwrites notes that changed on a daemon after the sync listed them; they are compared
again at the next sync. Notes with a change time more than five minutes in the future are refused,
and a notes file over 100 KB is neither synced nor replaced. Sync faults show in the app's console
and in `paseo plugin logs repo-notes`.

Notes you write on one daemon go into the prompts of agents on every daemon, so install the plugin
only on daemons you trust.

Deleting a notes file does not delete it on other daemons: the next sync brings it back. Empty the
file instead.

## Install

Install it on every daemon that shares notes:

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:repo-notes
```

Update with `paseo plugin update repo-notes`.
