# Usage pacer

A [Paseo](https://paseo.sh) plugin that runs the first mate's subscription usage guard each time an
agent starts a turn. The guard then stops managed crew over the cap within seconds, not at its next
3-minute watch. Callers no longer need to run the guard to have it enforced. Requires **Paseo 0.13.2 or
newer**, and the first mate's guard installed on the same host.

The plugin holds no usage rules. The caps, the 75% and 90% tiers, the weekend allowance, overrides and
`stopped.json` all stay in the guard (`home/server/paseo/subscriptionUsage` in myStuff).

## What it runs

When any agent starts a turn, the plugin runs
`python3 <guard> --bootstrap` with `FIRSTMATE_HOME` set:

- The guard is at `$PASEO_HOME/plugin-data/firstmate/home/data/subscription-usage-watch/assets/guard.py`.
  When `PASEO_HOME` is not set, `$PASEO_HOME` is `~/.paseo`.
- `--bootstrap` enforces once and prints no notice, so the first mate's watch notices are not affected.
- The guard decides which agents are managed: crew, registered roots and their descendants. It never
  stops the first mate or a human's agents.

Runs are debounced:

- A run starts at most once every 30 seconds.
- A turn that starts during a run queues one more run after it.
- A run that takes more than 150 seconds gets SIGTERM.
- Failures go to `paseo plugin logs usage-pacer`. The guard also writes them to `gate.json`, which closes
  dispatch.

The turn-start hook is a notification. Paseo does not wait for it, so the plugin cannot block or fail any
agent. If the guard is missing when the plugin starts, the plugin logs that once and does nothing. Reload
it after you install the guard.

## How a manager sees a hold

The guard labels each held agent `usage-guard.held=<provider>`. It also tells the agent's Paseo parent
once not to restart it. See the guard's README. Only the first mate, or Max, resumes a held agent.

## Install

The plugin is not published to npm (`"private": true`). Install it from Git, on each host that runs
the first mate. Add `--ref <commit>` to pin a version:

```sh
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:usage-pacer
```

## Tests

```sh
npm install && npm run typecheck && npm test
```

`server/guard-boundary.server.test.ts` runs the real guard against stubbed usage and stubbed Paseo
commands. It is skipped unless `USAGE_PACER_GUARD` points at `guard.py` in a myStuff clone:

```sh
USAGE_PACER_GUARD=/workspace/myStuff/home/server/paseo/subscriptionUsage/guard.py npm test
```
