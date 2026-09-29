# Cross-daemon

A [Paseo](https://paseo.sh) plugin that lets agents on different Paseo daemons list, message, start
and archive each other. Requires **Paseo 0.9.2 or newer**, installed on every daemon that takes part.

## Switching a daemon on

Open **Cross-daemon** in the app's sidebar. It lists every daemon the app is connected to, each
with a switch and the daemons it can reach. Switches are off by default. Daemons that are switched
on can reach each other; a switched-off daemon shares no link and keeps no peers. A daemon without
the plugin, or offline, is shown but cannot be switched.

The same switch is in each host's settings: **Settings → Plugins → cross-daemon ⋯ → Cross-daemon**.

While the app is open it syncs every host that has the plugin, one sync at a time: at connect, after
a switch change, and every minute. Each daemon gets the names and links of the other switched-on
daemons. The app is the only party that can reach every daemon, so a peer list changes only while
it is open; daemons keep their last list when it closes.

Switching off clears that daemon's peer list at once. The other daemons drop it at their next sync.

A daemon that does not answer a sync, for example a sleeping Mac, keeps its place on its peers'
lists until it answers switched off.

## Links

Each daemon gives its own relay pairing link, the same as `paseo pair`, only while it is switched
on. A pairing link grants full control of that daemon. Peers are stored owner-only in
`$PASEO_HOME/plugin-data/cross-daemon/`, which keeps other users out but not the daemon's own
agents: they run as the same user. The cross-daemon tools never print a link.

## Agent tools

Every new Claude, Codex or OpenCode agent on a daemon with the plugin gets a `cross-daemon` MCP
server. Other providers are left unchanged: Paseo refuses to create them with MCP servers or tool
approvals. Claude and Codex agents get the tools pre-approved; OpenCode does not, because a tool
policy turns off its auto-accept.

An agent keeps the tools it was created with. Agents created before the plugin, or before an
update that adds a tool, do not see the new tools.

Codex does not pass `PASEO_AGENT_ID` to MCP servers, so a message from a Codex agent cannot say
which agent sent it, and the receiver cannot reply to it.

## Tools

| Tool | What it does |
| --- | --- |
| `list_daemons` | The daemons this one can reach, by name and server ID. |
| `list_workspaces(daemon)` | That daemon's workspaces. |
| `list_agents(daemon)` | That daemon's agents, with status and folder. |
| `get_agent_activity(daemon, agentId, tail)` | An agent's recent activity. |
| `send_agent_prompt(daemon, agentId, prompt, notifyOnFinish)` | Sends a message; see below. |
| `create_agent(daemon, cwd, prompt, provider?, title?, notifyOnFinish)` | Starts a new agent; see below. |
| `archive_agent(daemon, agentId)` | Archives an agent that `create_agent` started, and the workspace it made for it. |

`daemon` is a name or a server ID; use the server ID when two daemons share a name.

## Starting and archiving agents

To hand new work to another daemon, start a fresh agent with `create_agent`. Do not message an
unrelated idle agent and ask it to relay the job. To give work to a particular agent, message it
with `send_agent_prompt`.

- The agent starts in exactly `cwd`, an absolute path on that daemon. It joins that daemon's
  workspace for the folder, if there is one, or else a new local workspace. It never joins the
  caller's workspace.
- Pass `provider` (such as `claude`) unless you know the daemon has a default: a daemon without one
  refuses the call.
- Its first message carries the same sender header as `send_agent_prompt`, so it can reply.
- The tool returns the new agent's ID, for `get_agent_activity`, `send_agent_prompt` and
  `archive_agent`.
- With `notifyOnFinish` (on by default), the caller is told when the agent finishes, as for
  `send_agent_prompt`.
- `paseo run` takes the prompt on its command line, so a first prompt is at most 30,000 characters,
  and other users of the calling machine can see it in `ps`.
- If the start times out, or the first prompt does not start, the tool says so. It does not report
  a start it cannot confirm.

`archive_agent` closes only agents that `create_agent` on this daemon started, so it cannot close
someone's own session by mistake. The record of those agents survives a restart. It refuses an agent
that is still working, and does not force one to stop.

After the agent, `archive_agent` archives the workspace that `create_agent` made for it. Archiving a
workspace archives every agent in it and closes its terminals, so the workspace is kept while any
other agent on that daemon is in the same folder. When a daemon has 200 agents or more, the plugin
cannot see them all, so it keeps the workspace. A workspace that `create_agent` did not make is never
archived.

## Sending without interrupting

`send_agent_prompt` never interrupts a working agent:

- If the agent is idle, the message goes at once with `paseo send`.
- If it is working, the message is queued and the sender is told so. Every 15 seconds the plugin
  delivers the oldest queued message for each agent that has become idle. The queue survives a
  restart.
- Each message says which agent and daemon sent it and how to reply.
- With `notifyOnFinish` (on by default), the sender is told when the agent finishes, with its last
  message. Paseo's own tool steers that notice into the sender's running turn; this one waits until
  the sender is idle, so it never interrupts the sender either.

The plugin checks and sends to one agent at a time, so two messages cannot both find an agent idle.
A target that starts a turn of its own between the plugin's check and its send is still interrupted,
as it would be by Paseo's own `send_agent_prompt`.

Limits, each reported to the sender:

- A message that waits more than 24 hours is dropped, as is a message to an agent that is archived,
  missing or ambiguous.
- A send cut off by a restart or a timeout is not repeated: it may have been delivered.
- At most 20 messages wait per agent, and a prompt is at most 50,000 characters.
- A finish notice is given up after 24 hours.

Every line the plugin adds to a message or notice carries a random marker, so text inside a message
cannot pose as the sender or as a reply target.

## Install

Install it on every daemon that takes part, then switch each one on in the app:

```bash
paseo plugin install paseo-cross-daemon
```

That installs the npm package. To install from Git instead:
`paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:cross-daemon`.
Update with `paseo plugin update cross-daemon`.

## License

MIT.
