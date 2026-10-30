# Shared stack: plan

One machine, several user accounts, each running its own Paseo daemon. One account (the **host**)
runs the dev stack from its own checkout (the **stack checkout**). Agents on any of the daemons
queue for that one stack. The agent at the front of the queue holds it: its workspace's working
tree is synced onto the stack checkout, and the stack's live reload picks it up. The holder
releases the stack, or times out, and the next agent gets it.

This is a separate plugin from Beam. Beam mirrors a workspace onto a checkout owned by the same
account and keeps its waiting list in one daemon's memory. Here the queue and the files cross
account boundaries, so both go through a shared group folder.

## Accounts and permissions

- All accounts are in one group (for example `paseo-users`). A shared folder owned by that group,
  setgid, with a default ACL that gives the group read and write, holds everything shared.
  Default: `/srv/paseo-shared/shared-stack`. Set at runtime in the plugin's config file; nothing
  machine-specific is in this repo.
- Each daemon process must actually have the group. A daemon started before its account was added
  to the group does not, until the process that started it (for a systemd user service, the user's
  systemd manager) restarts.
- No account reads another account's home folder. A guest daemon publishes its holder's working
  tree into a shared bare Git repository; only the host daemon writes to the stack checkout.
- The host account runs the stack. Running it is not this plugin's job.

## Files

In the shared folder:

| File          | Written by       | Content                                                         |
| ------------- | ---------------- | --------------------------------------------------------------- |
| `queue.json`  | every daemon     | holder, waiting list, daemon heartbeats, recent events          |
| `queue.lock`  | every daemon     | lock file, created with `O_EXCL`, held only for read-modify-write |
| `repo.git`    | holder's daemon  | bare repo (`--shared=group`); ref `refs/shared-stack/holder`    |
| `host.json`   | host daemon      | host heartbeat, last applied snapshot, last error               |

Per daemon, in `${PASEO_HOME:-~/.paseo}/plugin-data/shared-stack/`:

- `config.json`: `sharedDir` (optional) and, on the host only, `stackCheckout`.
- `index-<agent>`: a private Git index used to snapshot the holder's working tree cheaply.

## States

An entry is one agent on one daemon: `daemon` (account name), `agentId`, agent title, workspace
name, branch.

```
          stack_join                 front of queue, no holder
 (none) ─────────────▶ waiting ─────────────────────────────▶ holding
   ▲                     │  stack_release / forgotten             │
   └─────────────────────┘                                        │
   ▲        stack_release / lease expired / daemon gone /         │
   └──────────────────────── agent or workspace archived ─────────┘
```

- **Promotion**: any daemon, on its tick, under the lock, makes the first waiter the holder when
  there is none.
- **Lease**: a new holder has 10 minutes to call a stack tool; each tool call by the holder and
  each new snapshot extends the lease to 30 minutes. An expired lease releases the stack.
- **Daemon heartbeat**: each daemon writes its heartbeat every tick. Entries of a daemon silent for
  90 seconds are dropped, including a holder.
- **Waiters** are forgotten 60 minutes after their agent last called a stack tool.
- The owning daemon drops its own entries when their agent or workspace is archived.

## Sync

1. The holder's daemon snapshots the holder's working tree every 2 seconds: `git add -A` into its
   private index (stat-cached, so cheap after the first run), `write-tree`. If the tree changed, it
   commits it (parent: the workspace `HEAD`), force-pushes it to `refs/shared-stack/holder` in the
   shared repo, and records the commit in `queue.json`.
2. The host daemon sees a new snapshot for the current holder, fetches it into the stack checkout,
   and runs `git read-tree --reset -u <tree>`, which rewrites only files that differ. The first
   apply after the stack was free first saves the checkout's own state (working tree including
   untracked files, index, `HEAD`) under `refs/shared-stack/original`.
3. When nobody holds the stack, the host restores the saved state and deletes the ref.

Ignored files (`.env`, `node_modules`) are never copied or touched. `HEAD` and the branch of the
stack checkout do not move.

Git refuses repositories owned by another account; every Git call on the shared repo passes
`safe.directory` for that one path through the environment.

## Agent tools and UI

- `stack_status`: holder, waiting list in order, host status, and the caller's place.
- `stack_join` (`waitSeconds`, 0 to 540, default 300): joins the queue, or renews the caller's
  place, and waits up to `waitSeconds` to reach the front. A waiting agent that gets the stack
  while not inside a `stack_join` call is told so by its own daemon in a message.
- `stack_release`: leaves the queue, or releases the stack.

Paseo 0.14's own plugin agent tools only reach agents when the daemon injects the Paseo tool
catalog (`daemon.mcp.injectIntoAgents`), which is off by default and would hand every agent the
whole orchestration catalog. So, like Beam, the plugin serves its tools as a small stdio MCP server
that forwards each call over an owner-only Unix socket to the plugin process. It is added at
`agent.session_open` (launch-only, so agents that existed before the plugin get it on their next
open) with the agent's ID in its environment, which replaces Beam's Codex token mapping.

Each daemon's app gets a **Shared stack** sidebar screen: host status, holder, queue, recent
events, and a button to release or leave for entries that belong to this daemon.

## Out of scope

- Starting, stopping or rebuilding the stack, installing dependencies after a lockfile change,
  database migrations or resets between holders.
- Moving the stack checkout's branch or `HEAD`.
- Fairness beyond first come, first served; priorities; a holder handing over to a chosen agent.
- Several stacks.
- Daemons on other machines.
