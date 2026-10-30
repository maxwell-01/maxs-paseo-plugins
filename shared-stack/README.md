# Shared stack

A [Paseo](https://paseo.sh) plugin for one machine with several user accounts, each running its own
Paseo daemon, and one running dev stack they all share. Agents on any of the daemons queue for the
stack. The agent at the front of the queue holds it, and its workspace's working tree is synced
onto the stack's checkout, so the stack reloads with its changes. When it releases the stack, or
its hold runs out, the next agent gets it.

It is a separate plugin from [Beam](../beam/). Beam mirrors a workspace onto a checkout owned by the
same account. Here the queue and the files cross account boundaries, through a shared group folder.
See [PLAN.md](PLAN.md) for the design: states, files, permissions and what is out of scope.

Requires **Paseo 0.14.0 or newer** on every daemon.

## Agents

Every Claude, Codex and OpenCode agent gets three tools, from a small MCP server the plugin adds
when Paseo opens the agent's session. Agents that existed before the plugin get them the next time
their session opens. Claude and Codex agents created after the plugin is installed have the tools
preapproved.

- `stack_join`: joins the queue, or keeps the caller's place, and waits up to `waitSeconds`
  (default 300, most 540; `0` only joins) to reach the front. When the caller holds the stack, the
  reply says so. If the call ends first, the agent keeps its place. When it reaches the front later,
  its own daemon sends it a message that the stack is its own.
- `stack_status`: shows the holder, the queue in order, the caller's place, and the host's status.
- `stack_release`: releases the stack, or leaves the queue.

Other agents can run the same tools as a command; its shell has `PASEO_AGENT_ID`:

```bash
node "${PASEO_HOME:-$HOME/.paseo}/plugin-data/shared-stack/tool-proxy.cjs" stack_join --wait 120
node "${PASEO_HOME:-$HOME/.paseo}/plugin-data/shared-stack/tool-proxy.cjs" stack_status
node "${PASEO_HOME:-$HOME/.paseo}/plugin-data/shared-stack/tool-proxy.cjs" stack_release
```

A holder keeps the stack for 30 minutes after its last stack tool call or file change. A new holder
has 10 minutes to call a stack tool. A daemon that stops writing its heartbeat for 90 seconds loses
its places in the queue. A waiter that has not called a stack tool for 60 minutes is dropped.

## App

Each daemon's app gets a **Shared stack** sidebar item (and an **Open shared stack queue** command)
that shows the host, the holder, the queue and recent events. Entries of agents on that daemon have
a button to release the stack or leave the queue.

## Setup

1. Create a folder all the accounts can write, owned by their shared group, setgid, with a default
   ACL that gives the group read and write. The default path is `/srv/paseo-shared/shared-stack`;
   the plugin creates the `shared-stack` folder inside `/srv/paseo-shared` itself.
2. Make sure each daemon process has the group. An account added to the group after its daemon
   (or, for a systemd user service, its systemd user manager) started does not have it until that
   process restarts. `grep Groups /proc/<daemon pid>/status` shows the groups a daemon has.
3. Install the plugin on every daemon:

   ```bash
   paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:shared-stack
   ```

4. On the daemon of the account that runs the stack (the **host**), write
   `${PASEO_HOME:-~/.paseo}/plugin-data/shared-stack/config.json`:

   ```json
   {
     "stackCheckout": "/path/to/the/checkout/the/stack/serves",
     "stackUrl": "https://the-stack-url-you-want-agents-to-open"
   }
   ```

   Add `"sharedDir": "/some/other/folder"` on every daemon to use another shared folder. Then run
   `paseo plugin reload shared-stack`. Guest daemons need no config file.

The host account runs the stack itself, as it would without the plugin.

## How the sync works

- The holder's daemon snapshots the holder's working tree every 2 seconds, including uncommitted
  and untracked files and leaving out ignored ones. When the snapshot changed, it pushes it to a bare
  Git repository in the shared folder.
- The host daemon fetches each new snapshot into the stack checkout and updates only the files that
  differ, so the stack's file watchers only see real changes.
- Before the first holder's files land, the host saves the checkout's own state (working tree,
  untracked files, index) under `refs/shared-stack/original`. When nobody holds the stack, it puts
  that state back and deletes the ref. The checkout's branch and `HEAD` never move.
- Ignored files such as `.env` and `node_modules` are never copied or touched. A holder whose
  change needs new dependencies, migrations or a rebuild has to do that on the stack itself.

No account reads another's home folder. Git refuses repositories owned by another account, so the
plugin trusts the shared repository by path for its own Git calls only.

If the host stops while a holder's files are on the checkout, restore the checkout by hand:

```bash
git -C <stackCheckout> read-tree --reset -u 'refs/shared-stack/original^{tree}'
git -C <stackCheckout> read-tree 'refs/shared-stack/original^^{tree}'
git -C <stackCheckout> update-ref -d refs/shared-stack/original
```

## Development

```bash
cd shared-stack
npm install
npm run typecheck
npm test
```
