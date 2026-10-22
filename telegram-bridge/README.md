# Telegram bridge

A [Paseo](https://paseo.sh) plugin that lets you talk to one Paseo agent from a Telegram chat. The
agent keeps running in Paseo. Messages you send in the chat reach the agent's existing conversation,
and its replies come back to the chat. Photos and files work both ways. Requires **Paseo 0.11.1 or
newer**.

It uses Telegram's Bot API over long polling, so it needs no public URL and no webhook.

## Set it up

1. **Create a bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot` and
   follow the steps. BotFather gives you a token like `123456789:AA...`. Keep it secret: anyone
   with it can act as your bot.
2. **Let the bot read the group.** By default a bot in a group sees only commands, messages that
   mention it, and replies to its own messages. To send every group message to the agent, send
   BotFather `/setprivacy`, choose the bot and pick **Disable**. Then remove the bot from the group
   and add it again, because the change applies only when it joins. If you keep privacy on,
   mention the bot (`@your_bot ...`) or reply to one of its messages. In a private chat with the bot,
   every message reaches it.
3. **Add the bot to your group.**
4. **Install the plugin** on the daemon that runs the agent (see [Install](#install)).
5. **Fill in the settings** in the Paseo app: **Settings → Plugins → telegram-bridge → Telegram
   bridge**.
   - **Bot token**: from step 1.
   - **Agent id**: the agent the chat talks to. `paseo ls` shows agent ids, and so does the agent's
     menu in the app.
   - **Allowed user ids** and **Allowed chat ids**: leave them empty for now.
6. **Find your ids.** Send a message in the group (with privacy mode on, mention the bot in it).
   The bridge ignores it, because nobody is allowed yet, and writes a line like this to the plugin
   log:

   ```
   telegram-bridge: ignored a message from user 123456789 in chat -1001234567890 (Crew); add both ids to the settings to allow it
   ```

   See the log with `paseo plugin logs telegram-bridge`, or in the app under **Settings → Plugins →
   telegram-bridge → Logs**. Add the user id and the chat id to the settings and save. A group's id
   starts with `-`. Add each person who may talk to the agent.

The bridge restarts with the new values on every save.

## What happens to a message

- A message reaches the agent only if **both** its sender and its chat are allowed. Anything else
  is ignored and never reaches the agent; the log names the user and chat ids once, never the text.
- The agent gets `[Telegram, <first name>, in <chat>]: <text>`, where `<chat>` is the group's
  title or `direct chat`, then a line saying the reply goes back to Telegram and how to send a file.
- If the agent is busy with a message from the same chat, or with a turn you started in the app,
  the message joins its current turn rather than interrupting it. A message from another chat
  waits, and starts its own turn when the current one ends.
- A **photo** goes to the agent as an image, with its caption as the text.
- A **file** is saved under `$PASEO_HOME/plugin-data/telegram-bridge/files/<chat id>/`, readable by
  the daemon's user only, and its path and type are listed in the prompt. The agent must be allowed
  to read that folder; an agent that asks before each read waits for your approval in the app.
- Telegram lets a bot download files up to 20 MB. A bigger file is not fetched, and the prompt says
  so.
- Stickers, voice notes, videos and the like are not passed on. The bot answers "Only text, photos
  and files reach the agent." Service messages, such as a pin or a member joining, get no answer.

## What comes back

When the agent finishes a turn that took in a Telegram message, the bridge posts the agent's final
reply to that chat, as a reply to your newest message. A turn takes in messages from one chat only,
so each chat gets the answers to its own messages. The final reply is the text after the
agent's last tool call. A failed or canceled turn is reported as such.

- **Turns you start in the Paseo app are not posted to Telegram.**
- Text is sent as plain text, split into parts of up to 4096 characters, Telegram's limit.
- **Sending files:** a line of the reply that is exactly `[[send: /absolute/path]]` is taken out
  of the text and the file is uploaded. `.jpg`, `.jpeg`, `.png` and `.webp` files up to 10 MB go as
  photos; if Telegram refuses one as a photo, it goes as a file. Anything else up to 50 MB goes as
  a file. A path that is relative, missing or too big becomes a line of the reply that says why.
- **Files that are never sent**, whatever the reply says: hidden files, anything under the home
  folder that sits in a hidden folder (such as `~/.ssh` or `~/project/.git`), and anything inside
  `$PASEO_HOME` except the bridge's own files folder. Symlinks are followed before the check. Everyone in the group sees what the bot posts, so this keeps an agent
  that followed an injected instruction from posting a key or the bot token there.

## Limits

- One bot token, one agent. Only one program can poll a bot token at a time. If two daemons use
  the same token, the log says so and neither gets every message.
- A reply whose turn ends while the plugin is reloading, or the daemon is restarting, is not
  posted. The bridge keeps which message came from which chat in memory only; the agent's timeline
  holds the whole conversation, so a stored id could otherwise match a later turn started from the
  app.
- If the daemon stops while a message is being delivered, that message is dropped, never delivered
  twice.
- No message edits or deletions, and no voice notes.
- Files the chat sends are kept in the files folder until you delete them.
- The token is kept in the host's plugin settings file, readable by anyone who can manage that
  daemon.
- At start-up the bridge calls its own plugin RPC through the Paseo CLI that ships with the daemon,
  because the plugin API gives the Paseo SDK only to hook and RPC handlers. If that fails, the log
  says so, and the bridge starts at the next agent turn on that daemon.

## Self-hosted Bot API server

Set `TELEGRAM_BRIDGE_API_URL` in the daemon's environment, for example
`TELEGRAM_BRIDGE_API_URL=http://127.0.0.1:8081`, to use a
[local Bot API server](https://github.com/tdlib/telegram-bot-api) in place of
`https://api.telegram.org`.

## Install

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:telegram-bridge
```

Update it later with `paseo plugin update telegram-bridge`.

## Development

```bash
npm install
npm test
npm run typecheck
```

The tests run the bridge against a local fake Bot API HTTP server.
