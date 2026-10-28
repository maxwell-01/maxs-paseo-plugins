# Usage pacer

A [Paseo](https://paseo.sh) plugin that runs the first mate's subscription usage guard each time an
agent starts a turn. The guard then stops managed crew over the cap within seconds, not at its next
3-minute watch. Callers no longer need to run the guard to have it enforced. Requires **Paseo 0.13.2 or
newer**, and the first mate's guard installed on the same host.

The guard owns the usage rules: the caps, the tiers, the weekend allowance, overrides and `stopped.json`
(`home/server/paseo/subscriptionUsage` in myStuff). The plugin only runs it and can change the pacing
limits it reads, below.

## Pacing settings

The guard's pacing limits come from `pacing.json` in myStuff's paced-workflows skill. Edit them per host
in **Settings → Plugins → usage-pacer → Usage pacing**; an empty field shows the pacing.json value. The plugin keeps a
host settings document, `pacing`, with the same keys. Each value is optional; an unset value means "use
pacing.json". When the plugin starts and after every save, it writes the set values to
`pacing-overrides.json` beside the guard's `gate.json`. Every guard run on the host, the first mate's
watch included, merges that file over pacing.json. A bad value in it fails the guard closed.

| Setting              | pacing.json default | Meaning                                                     |
| -------------------- | ------------------- | ----------------------------------------------------------- |
| `weekly_target_pct`  | 90                  | Weekly usage to reach by the end of the pace period         |
| `contingency_5h_pct` | 10                  | 5-hour reserve; the 5-hour ceiling is 100 minus this        |
| `contingency_7d_pct` | 10                  | Weekly reserve; the weekly ceiling is 100 minus this        |
| `emergency_5h_pct`   | 90                  | 5-hour usage that forces minimum pace                       |
| `emergency_7d_pct`   | 90                  | Weekly usage that forces minimum pace                       |
| `stop_pct`           | 90                  | Hard stop: usage that pauses new work and stops crew        |
| `up_margin_pct`      | 15                  | Headroom a forecast needs below a limit before a raise      |
| `max_concurrency`    | 10                  | Most crew agents per provider                               |
| `weekly_pace`        | `working_week`      | `working_week`: reach the target by end of Friday; `whole_week`: pace evenly to the reset |

Percents are 0-100, `max_concurrency` is a whole number of at least 1. Removing the plugin leaves the
last `pacing-overrides.json` in place; delete it to go back to pacing.json.

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
