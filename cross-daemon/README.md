# Cross-daemon

A [Paseo](https://paseo.sh) plugin that lets agents on different Paseo daemons list and message each
other. Requires **Paseo 0.9.2 or newer**, installed on every daemon that takes part.

## Switching a daemon on

Each daemon's plugin settings have one switch, **Allow cross-daemon comms**, off by default. Daemons
that are switched on can reach each other. A switched-off daemon shares no link and keeps no peers.

Switching off clears that daemon's peer list at once. The other daemons drop it at their next sync.

A daemon that does not answer a sync, for example a sleeping Mac, keeps its place on its peers'
lists until it answers switched off.

## Links

Each daemon gives its own relay pairing link, the same as `paseo pair`, only while it is switched
on. A pairing link grants full control of that daemon. Peers are stored owner-only in
`$PASEO_HOME/plugin-data/cross-daemon/`, which keeps other users out but not the daemon's own
agents: they run as the same user. The cross-daemon tools never print a link.
