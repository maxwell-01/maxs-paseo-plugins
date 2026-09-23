# Beam

<img width="1283" height="288" alt="image" src="https://github.com/user-attachments/assets/bc223cb5-37dc-47c3-b929-d502be01520b" />


A [Paseo](https://paseo.sh) plugin that continuously mirrors a workspace's entire working tree
onto your local main checkout on disk, so an already-running dev environment with live-reload
shows the workspace's changes without you switching branches there.

Requires **Paseo 0.8 or newer**.

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

- a **Beam** header button (a ⚡ icon) in each workspace's header, next to the GitHub / "Update from
  main" controls — the primary control. It is the normal color when off and turns **yellow** while
  this workspace is beaming, with a tooltip that reflects the current state, and one click to beam in
  or out;
- a **Beam** workspace panel — toggle, status, and a live activity log of each sync;
- an **Open Beam** command-center item.

While a beam is active the workspace is also marked in Paseo's workspace list: its title gains a
⚡ prefix, and beam-out restores the title it had before. The original title is stored in the beam
state alongside main's branch and `HEAD`, so a beam-out after a daemon restart still puts it back.
If you rename the workspace during a beam, beam-out keeps your new name. A title that you start with
"⚡ " yourself loses that prefix at the next beam-out, because Beam cannot tell it from its own mark.

Beam does not message your agents. Claude agents learn about a beam from the `beam-awareness` hook
in [maxwell-01/myStuff](https://github.com/maxwell-01/myStuff) (`claudeConfig/plugins/beam-awareness`),
which adds hidden context to each prompt: an agent in the beaming workspace is told its changes appear
in the main checkout, and an agent in the main checkout is warned its edits are discarded at beam-out.
The hook reads `mainPath` from `~/.paseo-beam-active.json` and `workspaceDir` from
`<mainPath>/.git/beam-state.json`, so changing either file's path or those fields breaks it.

## Install

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:beam
paseo plugin ls
```

Then open a workspace and either click the **Beam** (⚡) button in the workspace header, or open the
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

- **One beam at a time, machine-wide.** Beam tracks the single active mirror through a home pointer
  file (`~/.paseo-beam-active.json`) plus a per-checkout state file
  (`<mainPath>/.git/beam-state.json`). Beaming a second workspace — even onto a different checkout —
  while one is already active is rejected; beam out first.
- **Ignored during watch:** any path segment named `.git`, `node_modules`, or `.context`, and any
  filename containing `.tmp.`.
- **Crash caveat.** If Paseo or your machine stops while a beam is active, main stays mirrored until
  you beam out (which performs the restore). The snapshot survives under `refs/beam/original` even if
  the state file is lost, because that ref is a 3-commit chain: the snapshot commit's tree is main's
  full pre-beam working tree, its parent commit's tree is the pre-beam index, and its grandparent is
  the pre-beam `HEAD`. Restore by hand with:
  ```bash
  git -C <mainPath> read-tree --reset -u refs/beam/original^{tree}
  git -C <mainPath> reset --soft refs/beam/original^^
  git -C <mainPath> read-tree refs/beam/original^^{tree}
  git -C <mainPath> update-ref -d refs/beam/original
  ```
  A plain `git -C <mainPath> reset --hard refs/beam/original` only gets the working-tree *contents*
  right — it leaves the branch pointed at the synthetic `beam: pre-beam snapshot` commit instead of
  your real pre-beam `HEAD`, and it collapses whatever was staged vs. unstaged into one committed
  state. Use the four commands above to reproduce the pre-beam state exactly.

## Development

```bash
cd beam
npm install
npm run typecheck
npm test
```
