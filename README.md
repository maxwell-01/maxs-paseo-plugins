# Max's Paseo plugins

[Paseo](https://paseo.sh) plugins, one per folder. Each folder is a self-contained plugin with its
own `package.json`, tests and README.

| Plugin | What it does |
| --- | --- |
| [beam](beam/) | Mirrors a workspace's working tree onto your main checkout, so a running dev environment shows its changes. |
| [crew-flows](crew-flows/) | Shows each repo's crew-flows workflow, its agent roles, and the teams running now. |
| [cross-daemon](cross-daemon/) | Lets agents on different Paseo daemons list and message each other, without interrupting a working agent. |
| [fold-crew-updates](fold-crew-updates/) | Folds every message you did not write, such as agent notifications and cross-daemon messages, into one closed row in an agent chat. |
| [repo-notes](repo-notes/) | Gives every agent your own notes for its repo, kept out of the repo and synced across daemons. |
| [usage-pacer](usage-pacer/) | Paces Claude and Codex subscription usage and stops agents over the limit, checked when any agent starts a turn and every 3 minutes. On npm as `paseo-usage-pacer`. |
| [telegram-bridge](telegram-bridge/) | Lets you talk to one Paseo agent from a Telegram chat, with photos and files both ways. |

## Install

Append the plugin's folder to the repo URL:

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:<folder>
```

## Test a plugin build

Never try a build on your own Paseo: a reload or Update there can undo it, and a restart cuts off
your running agents. `scripts/paseo-sandbox.sh` starts a second, throwaway Paseo from your installed
Paseo app, with its own home (`/tmp/paseo-check`) and port (6799). Your own daemon, agents, plugins
and settings stay untouched.

```bash
(cd beam && npm ci && npm run typecheck)          # build the plugin first
scripts/paseo-sandbox.sh up                       # prints http://127.0.0.1:6799/
scripts/paseo-sandbox.sh install beam             # a folder, or a git or npm source
scripts/paseo-sandbox.sh install https://github.com/maxwell-01/maxs-paseo-plugins.git:beam --ref <branch>
scripts/paseo-sandbox.sh paseo plugin logs beam   # any paseo command, run against the sandbox
scripts/paseo-sandbox.sh paseo plugin reload beam # after an edit
scripts/paseo-sandbox.sh down                     # stop it and delete its home
```

To see the plugin's screens, open the printed URL in a browser. It is the Paseo web app, connected
only to the sandbox. A workspace panel needs a workspace, so register a scratch git repository
first: `scripts/paseo-sandbox.sh paseo project create <repo>`, then
`scripts/paseo-sandbox.sh paseo workspace create --isolation local --path <repo> --title scratch`.
An agent drives the page with its own browser tool. A fresh browser does not open a workspace
from its URL, so click the workspace in the sidebar.

The sandbox has every agent provider switched off and uses none of your logins. So it cannot test:

- anything that needs an agent to run a turn, such as lifecycle hooks on a turn or tools given to
  agents;
- usage readings (usage is off) and the relay (off: no phone, no other daemon through it);
- the desktop app itself. You see the web app, which runs the same plugin client code.

## License

MIT. See [LICENSE](LICENSE).
