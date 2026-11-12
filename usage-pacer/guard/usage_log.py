#!/usr/bin/env python3
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import time

HOUR = 3600
MAX_GAP_SECONDS = 30 * 60
LOG_NAME = 'usage-log.jsonl'


def reset_epoch(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def append_reading(path, host, live, active, now):
    windows = {f"{p['providerId']}/{w['id']}": [w['usedPct'], reset_epoch(w['resetsAt'])]
               for p in live['providers'] for w in p.get('windows', [])}
    with path.open('a') as log:
        log.write(json.dumps({'ts': now, 'host': host, 'active': active, 'windows': windows}) + '\n')


def read_logs(paths):
    return [json.loads(text) for path in paths for text in Path(path).read_text().splitlines() if text.strip()]


def rises_by_hour(rows, key):
    rises, prior, peak = {}, None, None
    for ts, pct, reset in sorted((row['ts'], *row['windows'][key]) for row in rows if key in row['windows']):
        if prior and abs(reset - prior[1]) < 2:
            if ts - prior[0] <= MAX_GAP_SECONDS:
                hour = int(ts // HOUR)
                rises[hour] = rises.get(hour, 0) + max(0, pct - peak)
            peak = max(peak, pct)
        else:
            peak = pct
        prior = (ts, reset)
    return rises


def hourly_report(rows, start, end):
    busy_hours = {int(row['ts'] // HOUR) for row in rows if row['active'] > 0}
    keys = sorted({key for row in rows for key in row['windows']})
    report = {}
    for key in keys:
        totals = {'idle': [0, 0], 'busy': [0, 0]}
        for hour, rise in rises_by_hour(rows, key).items():
            if start <= hour * HOUR < end:
                kind = totals['busy' if hour in busy_hours else 'idle']
                kind[0] += 1
                kind[1] += rise
        report[key] = {kind: {'hours': hours, 'pct_per_hour': round(rise / hours, 2) if hours else None}
                       for kind, (hours, rise) in totals.items()}
    return report


def describe(kind, numbers):
    rate = '' if numbers['pct_per_hour'] is None else f" at {numbers['pct_per_hour']}%/h"
    return f"{kind} {numbers['hours']} h{rate}"


def main():
    parser = argparse.ArgumentParser(description='Account usage per hour, idle vs busy, from guard usage logs.')
    parser.add_argument('--log', action='append', type=Path,
                        help=f'a {LOG_NAME} to read; repeat for each machine (default: this machine\'s)')
    parser.add_argument('--hours', type=float, default=48, help='how far back to report (default 48)')
    args = parser.parse_args()
    paths = args.log or [Path(os.environ['FIRSTMATE_HOME']) / 'data/subscription-usage-watch' / LOG_NAME]
    rows = read_logs(paths)
    now = time.time()
    print(f'Usage per hour over the last {args.hours:g} h from {len(rows)} readings on '
          f"{', '.join(sorted({row['host'] for row in rows})) or 'no host'}. "
          'Idle means no managed agent was active on any logged machine in that hour; '
          'human and unlogged machines still count.')
    for key, kinds in hourly_report(rows, now - args.hours * HOUR, now).items():
        print(f"{key}: {describe('idle', kinds['idle'])}; {describe('busy', kinds['busy'])}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
