# Usage pacer

A [Paseo](https://paseo.sh) plugin that keeps your Claude and Codex subscriptions from running out.
It reads your account usage, sets how many agents may work at once, and stops agents when usage
reaches the hard limit. It runs when any agent starts a turn and every 3 minutes.

## Requirements

- Paseo 0.13.2 or newer.
- `python3` 3.9 or newer on the machine that runs the Paseo daemon.
- Linux or macOS (the guard uses `fcntl`).
- A Claude or Codex subscription that Paseo can read usage for.

## Install

```sh
paseo plugin add npm:paseo-usage-pacer
```

Or from Git:

```sh
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:usage-pacer
```

## What it does

The plugin copies a Python guard to `$PASEO_HOME/plugin-data/usage-pacer/guard/` on every start
(`$PASEO_HOME` is `~/.paseo` unless you set it). The guard:

- Sets a cap per provider: how many managed agents may work at once.
- Paces weekly usage. `weekly_pace` chooses whether to reach the target by the end of Friday or evenly
  across the whole week (see the table below).
- Stops managed agents when usage reaches `stop_pct` (90% by default), newest first.
- Labels each stopped agent `usage-guard.held=<provider>` and sends its parent one message saying not to
  restart it. Restart the agent yourself, or let whoever runs it do so, when usage allows.
- Prints an alert when a weekly window is forecast to end at 85% or more.

The turn-start run enforces and prints nothing. The 3-minute run also prints changes and alerts. Both go to
`paseo plugin logs usage-pacer`. Runs start at most once every 30 seconds, and a run that takes over 150
seconds is stopped. The turn-start hook is a notification, so the plugin never blocks an agent.

## Which agents it manages

Every agent that is not archived. To manage fewer, create
`~/.paseo/plugin-data/usage-pacer/config.json`:

```json
{
  "managed_labels": ["team=batch"],
  "manager_labels": ["role=orchestrator"],
  "managed_roots": ["<agent id>"],
  "task_label": "usage-pacer.task"
}
```

- `managed_labels`: an agent with any of these `key=value` labels, and its descendants, are managed.
- `manager_labels`: children of an agent with any of these labels, and their descendants, are managed. The
  manager is not.
- `managed_roots`: agent IDs, and their descendants, that are managed.
- `task_label`: the label key that `--override` and `--task` match. Default `usage-pacer.task`.

If `managed_labels` and `manager_labels` are both missing or empty, every agent is managed. A bad value in
this file makes the guard fail closed (dispatch checks are refused).

## Use from scripts and managers

```sh
python3 ~/.paseo/plugin-data/usage-pacer/guard/guard.py --check claude [--slots N]
```

Exit code 0 means N more agents may start now; 2 means they may not. It prints a JSON line with the cap
and the number of active agents. Add `--target-agent ID --turn-started-at EPOCH` to refuse when that agent
was stopped during the turn.

To let one task bypass the guard, give its agents the `task_label` label with the task id, then run:

```sh
python3 ~/.paseo/plugin-data/usage-pacer/guard/guard.py --override TASK --hours 4
```

`--hours 0` removes it. `--check claude --task TASK` is then allowed while the override lasts.

`python3 ~/.paseo/plugin-data/usage-pacer/guard/usage_log.py` reports account usage per hour, idle against
busy, from `usage-log.jsonl`.

## Where state lives

All in `$PASEO_HOME/plugin-data/usage-pacer/`:

- `gate.json`: the current caps and any enforcement error.
- `stopped.json`: agents the guard stopped.
- `overrides.json`: active task overrides.
- `pacing-overrides.json`: pacing values from the plugin settings.
- `usage-log.jsonl`: one usage reading per run.
- `watch-state/`: what the last run printed, so repeats stay quiet.

## Pacing settings

The pacing limits default to the `pacing.json` in `guard/`. Change them per host in
**Settings > Plugins > usage-pacer > Usage pacing**; an empty field uses the pacing.json value. When the
plugin starts and after every save, it writes the values you set to `pacing-overrides.json`, and every guard
run merges that file over pacing.json. A bad value fails the guard closed.

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

Claude and Codex have only weekly limits now. The guard ignores their 5-hour window, so
`contingency_5h_pct` and `emergency_5h_pct` do not apply to them.

Percents are 0-100, `max_concurrency` is a whole number of at least 1. Removing the plugin leaves the
last `pacing-overrides.json` in place; delete it to go back to pacing.json.

To pause all pacing, put `{"sharing": "off"}` in `~/.claude/paced-workflows/sharing.json`.

## Use with FirstMate

On hosts that run FirstMate, set its labels in `config.json`:

```json
{
  "managed_labels": ["firstmate.role=crew"],
  "manager_labels": ["firstmate.role=first-mate"],
  "task_label": "firstmate.task"
}
```

## Limits

- It cannot veto a prompt. It stops an agent after the turn has started.
- Paseo caches account usage for about 5 minutes, so the guard can lag.
- Your own use of the account counts against the limits, and the percentages cover the whole account, not
  only managed agents.

## Tests

```sh
npm install && npm run typecheck && npm test
```

`server/guard-boundary.server.test.ts` runs the real guard against stubbed usage and stubbed Paseo
commands. After you change a file in `guard/`, run `npm run embed:guard`; a test fails when the embedded
copy is stale.
