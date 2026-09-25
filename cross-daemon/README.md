# Cross-daemon

A [Paseo](https://paseo.sh) plugin that lets agents on different Paseo daemons list and message each
other. Requires **Paseo 0.9.2 or newer**, installed on every daemon that takes part.

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

`daemon` is a name or a server ID; use the server ID when two daemons share a name.

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
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:cross-daemon
```

Update with `paseo plugin update cross-daemon`.
