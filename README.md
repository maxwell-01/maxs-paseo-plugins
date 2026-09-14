# Beam

<img width="874" height="192" alt="Beam pill inactive in the composer" src="https://github.com/user-attachments/assets/a7740c5d-b09c-40a1-baef-0c6424f1b81d" />
<img width="893" height="196" alt="Beam pill active while beaming" src="https://github.com/user-attachments/assets/11d6d2cf-1bff-4361-b7bb-e93f4563fb75" />

A [Paseo](https://paseo.sh) plugin that continuously mirrors a workspace's entire working tree
onto your local main checkout on disk, so an already-running dev environment with live-reload
shows the workspace's changes without you switching branches there.

Similar to Conductor's Spotlight feature.

## What it does

While a beam is active, Beam watches the workspace directory and, on every change, overwrites your
main checkout to match the workspace's current working tree:

- **Beam in** — snapshots main's exact current state (branch, `HEAD`, index, and full working tree
  including uncommitted, staged, and untracked files), then starts a file watcher on the workspace
  and runs an immediate sync. Each sync moves main's branch to the workspace's `HEAD` and rewrites
  main's tracked working tree and index to a snapshot of the workspace's full working tree.
- **Beam out** — stops the watcher and **restores main to exactly its pre-beam state** — branch,
  working tree, index, and untracked files all come back as if nothing ever happened.

The mirror is the **full working tree**, including uncommitted and untracked files, not just
committed changes. `.gitignore` is respected, so ignored files (for example `.env`, `node_modules`)
are **not** copied from the workspace, and main's own ignored files **survive** each sync. This is
intentional: your running stack keeps its local environment.

Syncs are mtime-stable: only files that actually differ are rewritten, so the dev server's watcher
only reacts to real changes.

Beam appears in three places:

- a **Beam** toggle pill in each agent's composer — reads "Beam" when off and "⚡ Beaming" (yellow)
  while active, with a hover tooltip, and one click to beam in or out;
- a **Beam** workspace panel — toggle, status, and a live activity log of each sync;
- an **Open Beam** command-center item.

## Install

```bash
paseo plugin install /absolute/path/to/paseo-beam
paseo plugin ls
```

Then open a workspace and either click the **Beam** pill in an agent's composer, or open the
**Beam** panel (or run **Open Beam** from the command center), and beam in.

## Reversible — your main checkout is safe

Beam is **reversible**. Beaming in is safe even when main has uncommitted, staged, or untracked
work: before the first sync, Beam captures main's complete state as a git object snapshot stored
under `refs/beam/original` (a real commit chain in the object store — **not** `git stash`, which is
left untouched). Beaming out restores main's branch pointer, working tree, index, and untracked
files to exactly that snapshot, so it is as if the beam never happened, and it deletes the temporary
ref. Beaming in on a dirty main is therefore fine.

Ignored files (for example `.env`, `node_modules`) are never captured, never mirrored, and never
touched during beam-in, sync, or beam-out.

## Notes and limitations

- **One beam at a time.** Beam tracks a single active mirror through a home pointer file
  (`~/.paseo-beam-active.json`) and a per-checkout state file (`<mainPath>/.git/beam-state.json`).
  Beaming a second workspace onto a checkout that already has an active beam is rejected; beam out
  first.
- **Ignored during watch:** any path segment named `.git`, `node_modules`, or `.context`, and any
  filename containing `.tmp.`.
- **Crash caveat.** If Paseo or your machine stops while a beam is active, main stays mirrored until
  you beam out (which performs the restore). The snapshot survives under `refs/beam/original`; if the
  state file is lost, restore by hand with `git -C <mainPath> reset --hard refs/beam/original` (that
  commit's tree is main's full pre-beam working tree).

## Development

```bash
npm install
npm run typecheck
```
