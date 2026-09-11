# Beam

A [Paseo](https://paseo.sh) plugin that continuously mirrors a workspace's entire working tree
onto your local main checkout on disk, so an already-running dev environment with live-reload
shows the workspace's changes without you switching branches there.

Similar to Conductor's Spotlight feature.

## What it does

While a beam is active, Beam watches the workspace directory and, on every change, overwrites your
main checkout to match the workspace's current working tree:

- **Beam in** — starts a file watcher on the workspace and runs an immediate sync. Each sync moves
  main's branch to the workspace's `HEAD` and rewrites main's tracked working tree and index to a
  snapshot of the workspace's full working tree.
- **Beam out** — stops the watcher. It does **not** restore main (see below); main is left mirroring
  the workspace.

The mirror is the **full working tree**, including uncommitted and untracked files, not just
committed changes. `.gitignore` is respected, so ignored files (for example `.env`, `node_modules`)
are **not** copied from the workspace, and main's own ignored files **survive** each sync. This is
intentional: your running stack keeps its local environment.

Syncs are mtime-stable: only files that actually differ are rewritten, so the dev server's watcher
only reacts to real changes.

The plugin adds a **Beam** workspace panel (toggle, status, and the restore command while active)
plus an **Open Beam** command-center item.

## Install

```bash
paseo plugin install /absolute/path/to/paseo-beam
paseo plugin ls
```

Then open a workspace, choose the **Beam** panel (or run **Open Beam** from the command center),
and press **Beam in**.

## Destructive to main — read this

Beam is **destructive** to your main checkout. Each sync:

- moves main's current branch to the workspace's `HEAD` commit, and
- overwrites main's tracked working tree and index with the workspace snapshot.

Any uncommitted tracked work in main at the time you Beam in is **lost**. Commit or stash it first.

**Beam out does not restore main.** When you Beam out, main is left mirroring the workspace. To put
main back where it was, use the command shown in the panel while active:

```bash
git -C <mainPath> reset --hard <originalHead>
```

Beam records `originalHead` and `originalBranch` when you Beam in and surfaces them in the panel, so
you always have the exact command to recover.

## Notes and limitations

- **One beam at a time.** Beam tracks a single active mirror through a home pointer file
  (`~/.paseo-beam-active.json`) and a per-checkout state file (`<mainPath>/.git/beam-state.json`).
  Beaming a second workspace onto a checkout that already has an active beam is rejected; beam out
  first.
- **No persisted checkpoint refs.** Unlike some mirroring tools, Beam does not write checkpoint refs
  into the repo. Each sync recomputes the workspace `HEAD` and a fresh snapshot tree, which is
  enough; there is nothing extra to clean up.
- **Ignored during watch:** any path segment named `.git`, `node_modules`, or `.context`, and any
  filename containing `.tmp.`.
- **Crash caveat.** If Paseo or your machine stops while a beam is active, main stays mirrored (no
  automatic restore). Beam out on next launch, or run the restore command above.

## Development

```bash
npm install
npm run typecheck
```
