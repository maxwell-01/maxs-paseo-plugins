# fold-crew-updates

Folds every message you did not write into one closed, expandable row in an agent's chat, so your
own messages and the replies stay easy to find.

It folds a user message that starts with one of these:

- `<paseo-system ...>`: Paseo agent notifications
- `<firstmate-watch ...>`: first mate watch blocks
- `[cross-daemon ...]`: cross-daemon messages and notices

The closed row shows the source and the first 80 characters. Tap it to read the full message.

## Limits

- It folds the incoming message only. The agent's reply stays open: a Paseo timeline transformer sees
  one item at a time, with no link to the turn it belongs to, so it cannot fold the reply.
- It matches by text, so a message you type that starts with one of the markers is folded too.

## Install

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:fold-crew-updates
```

Needs Paseo 0.9.2 or later. Client only: nothing runs on the daemon.
