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
(`$PASEO_HOME` is `~/.paseo` unless you set it; every path below uses it). The guard:

- Sets a cap per provider: how many managed agents may work at once.
- Paces weekly usage. `weekly_pace` chooses whether to reach the target by the end of Friday or evenly
  across the whole week (see the table below).
- Stops managed agents when usage reaches `stop_pct` (90% by default), newest first.
- Labels each stopped agent `usage-guard.held=<provider>` and sends its parent one message saying not to
  restart it. Restart the agent yourself, or let whoever runs it do so, when usage allows.
- Prints an alert when a weekly window is forecast to end at 85% or more.

The turn-start run enforces and prints nothing. The 3-minute run also prints changes and alerts. Both go to
`paseo plugin logs usage-pacer`. Runs start at most once every 30 seconds per trigger (turn-start runs and 3-minute runs are paced
separately), and a run that takes over 150
seconds is stopped. The turn-start hook is a notification, so the plugin never blocks an agent.

## Which agents it manages

Every agent that is not archived. To manage fewer, create
`$PASEO_HOME/plugin-data/usage-pacer/config.json`:

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

If `managed_labels` and `manager_labels` are both missing or empty, every agent is managed. While this file has a
bad value, dispatch checks are refused and no agents are stopped.

## Use from scripts and managers

```sh
python3 "${PASEO_HOME:-$HOME/.paseo}"/plugin-data/usage-pacer/guard/guard.py --check claude [--slots N]
```

Exit code 0 means N more agents may start now, 2 means they may not, and 1 means the guard failed or
has an enforcement error. It prints a JSON line with the cap
and the number of active agents. Scripts can set `USAGE_PACER_STATE` to use another state folder (default: the folder above `guard/`) and
`USAGE_PACER_NOTICE_STATE` to use another `watch-state/` folder. Add `--target-agent ID --turn-started-at EPOCH` to refuse when that agent
was stopped during the turn.

To let one task bypass the guard, give its agents the `task_label` label with the task id, then run:

```sh
python3 "${PASEO_HOME:-$HOME/.paseo}"/plugin-data/usage-pacer/guard/guard.py --override TASK --hours 4
```

`--hours 0` removes it. `--check claude --task TASK` is then allowed while the override lasts.

`python3 "${PASEO_HOME:-$HOME/.paseo}"/plugin-data/usage-pacer/guard/usage_log.py` reports account usage per hour, idle against
busy, from `usage-log.jsonl`.

## Where state lives

All in `$PASEO_HOME/plugin-data/usage-pacer/`:

- `gate.json`: the current caps and any enforcement error.
- `stopped.json`: agents the guard stopped.
- `overrides.json`: active task overrides.
- `pacing-overrides.json`: pacing values from the plugin settings.
- `usage-log.jsonl`: one usage reading per run.
- `watch-state/`: what the last run printed, so repeats stay quiet.

## Usage from another source

When Paseo cannot read a provider's usage (the provider is missing from its answer, or its status is not `available`), the guard reads
`fallback-usage.json` in the state folder (`$PASEO_HOME/plugin-data/usage-pacer/`, or `$USAGE_PACER_STATE`). The shape matches what the
guard reads from Paseo, one entry per provider:

```json
{"claude": {"fetchedAt": "2026-11-20T09:00:00Z",
            "windows": [{"id": "weekly", "usedPct": 83.0, "resetsAt": "2026-11-23T00:00:00Z"}]}}
```

A reading counts for 15 minutes after its `fetchedAt`; Paseo's own readings still count for 5. The file is never used for a provider whose
Paseo reading is `available`. Weekly windows the file leaves out (such as `weekly_model_fable`) stay in force from the last good reading
until they reset, so a fall-back reading cannot reopen a gate one of them closed.

A reading that is too old, dated in the future, or unreadable (not valid JSON, or an entry whose `windows` is not a list of objects that includes `weekly`) is
treated like a stale Paseo reading. With no earlier good reading the provider's gate stays closed. With one, the guard holds its last
decision and steps the cap down over time, and the gate reason says why. A bad file never affects a provider whose Paseo reading is
`available`.

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
| `stop_pct`           | 90                  | Hard stop: usage that pauses new work and stops managed agents |
| `up_margin_pct`      | 15                  | Headroom a forecast needs below a limit before a raise      |
| `max_concurrency`    | 10                  | Most managed agents per provider                            |
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
