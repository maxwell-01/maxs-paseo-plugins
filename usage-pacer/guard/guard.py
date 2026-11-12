#!/usr/bin/env python3
import argparse
from datetime import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

from holds import LIVE, clear_hold_label, resumed_agent_ids, set_hold_label, stale_hold_ids, tell_parents
from pace_alert import pace_alerts
from policy import decide, with_overrides
from slots import stop_order, waiting_ids, working_agents
from state_dir import state_dir
from usage_log import LOG_NAME, append_reading

HERE = Path(__file__).resolve().parent
RETRY_SECONDS = 5
RETRY_DEADLINE_SECONDS = 30
WINDOWS_WITHOUT_A_LIMIT = {'claude': {'five_hour'}}


def epoch(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError, TypeError):
        return None


def windows_with_a_limit(provider, windows):
    return [w for w in windows if w.get('id') not in WINDOWS_WITHOUT_A_LIMIT.get(provider, set())]


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, sort_keys=True))
    temp.replace(path)


def label_pairs(config, key):
    pairs = config.get(key) or []
    if not isinstance(pairs, list) or not all(isinstance(p, str) and '=' in p for p in pairs):
        raise ValueError(f'{key} must be a list of key=value strings')
    return [tuple(p.split('=', 1)) for p in pairs]


def has_label(agent, pairs):
    labels = agent.get('labels') or {}
    return any(labels.get(key) == value for key, value in pairs)


def with_descendants(agents, ids):
    ids = set(ids)
    while True:
        children = {a['id'] for a in agents if a.get('parentAgentId') in ids}
        if children <= ids:
            return ids
        ids |= children


def managed_agents(agents, config, overridden):
    managed_labels, manager_labels = label_pairs(config, 'managed_labels'), label_pairs(config, 'manager_labels')
    task_label = config.get('task_label', 'usage-pacer.task')
    if not isinstance(task_label, str) or not task_label:
        raise ValueError('task_label must be a label key')
    paused = {a['id'] for a in agents if (a.get('labels') or {}).get(task_label) in overridden}
    if managed_labels or manager_labels:
        managers = {a['id'] for a in agents if has_label(a, manager_labels)}
        seeds = {a['id'] for a in agents if (has_label(a, managed_labels) or a.get('parentAgentId') in managers)
                 and a['id'] not in paused} | set(config.get('managed_roots', []))
        owned = with_descendants(agents, seeds)
    else:
        owned = {a['id'] for a in agents} - with_descendants(agents, paused)
    return [a for a in agents if a['id'] in owned and not a.get('archivedAt')]


def parents_by_id(agents):
    return {a['id']: a.get('parentAgentId') for a in agents}


def created_at(agent):
    return epoch(agent.get('createdAt')) or math.inf


def provider_key(agent, bases):
    key = agent['provider'].split('/')[0].lower()
    visited = set()
    while key in bases:
        if key in visited:
            raise ValueError('provider alias cycle')
        visited.add(key)
        key = bases[key].lower()
    if key not in ('claude', 'codex'):
        raise ValueError('managed agent provider has no subscription source')
    return key


def active_overrides(data_dir, now):
    return {task for task, entry in read_json(data_dir / 'overrides.json', {}).items() if entry['until'] > now}


def set_override(data_dir, task, hours):
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time()
        overrides = {key: entry for key, entry in read_json(data_dir / 'overrides.json', {}).items()
                     if entry['until'] > now and key != task}
        if hours > 0:
            overrides[task] = {'until': now + hours * 3600}
        write_json(data_dir / 'overrides.json', overrides)
    print(json.dumps({'overrides': overrides}))
    return 0


def without_reasons(summary):
    return dict(summary, providers={key: {k: v for k, v in provider.items() if k != 'reason'}
                                    for key, provider in summary['providers'].items()})


def app_bundle_runtime(cli):
    resources = Path(cli).resolve().parent.parent
    helper = resources.parent / 'Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper'
    if not ((resources / 'app.asar').is_file() and helper.is_file()):
        return {}
    return {'node': str(helper), 'sdk': str(resources / 'app.asar/node_modules/@getpaseo/cli/dist/index.js')}


def snapshot(config):
    cli = config.get('cli') or os.environ.get('PASEO_CLI') or shutil.which('paseo')
    if not cli:
        raise ValueError('Paseo CLI unavailable')
    runtime = {} if 'node' in config or 'sdk' in config else app_bundle_runtime(cli)
    response = subprocess.run([config.get('node') or runtime.get('node', 'node'), str(HERE / 'paseo-source.mjs'),
                               config.get('sdk') or runtime.get('sdk', cli), config['paseo_home']],
                              capture_output=True, text=True, timeout=40,
                              env=dict(os.environ, ELECTRON_RUN_AS_NODE='1'))
    if response.returncode:
        raise RuntimeError('Paseo snapshot failed: ' + response.stderr.strip())
    return json.loads(response.stdout), cli


def snapshot_with_retry(config):
    started = time.monotonic()
    try:
        live, cli = snapshot(config)
        if all(p.get('status') == 'available' for p in live['providers']):
            return live, cli
    except (RuntimeError, ValueError, subprocess.SubprocessError, OSError):
        if time.monotonic() - started > RETRY_DEADLINE_SECONDS:
            raise
    time.sleep(RETRY_SECONDS)
    return snapshot(config)


def run(data_dir, watch_state, bootstrap=False, check=None, slots=1, target=None, started_at=0, task=None):
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return run_locked(data_dir, watch_state, bootstrap, check, slots, target, started_at, task)


def run_locked(data_dir, watch_state, bootstrap, check, slots, target=None, started_at=0, task=None):
    config = {'paseo_home': str(data_dir.parent.parent), **read_json(data_dir / 'config.json', {})}
    gate_path = data_dir / 'gate.json'
    now = time.time()
    previous = read_json(gate_path, {})
    overridden = active_overrides(data_dir, now)
    pacing = with_overrides(read_json(data_dir / 'pacing-overrides.json', {}))
    error, snapshot_failure = None, None
    try:
        live, cli = snapshot_with_retry(config)
    except (RuntimeError, ValueError, subprocess.SubprocessError, OSError) as failure:
        live, cli = {'providers': [], 'agents': [], 'bases': {}}, config.get('cli')
        error = 'Paseo snapshot unavailable; dispatch closed, active fleet enforcement unverified'
        snapshot_failure = failure
    now = time.time()
    crew = managed_agents(live['agents'], config, overridden)
    crew_was_running = any(a['status'] == 'running' for a in crew)
    live_crew = [a for a in crew if a['status'] in LIVE]
    parent_of = parents_by_id(live['agents'])
    provider_of = {a['id']: provider_key(a, live['bases']) for a in live_crew}
    working = working_agents(live_crew, parent_of)
    if error is None:
        append_reading(data_dir / LOG_NAME, socket.gethostname(), live, len(working), now)
    providers, slots_in_use = {}, {}
    for key in ('claude', 'codex'):
        slots_in_use[key] = [a for a in working if provider_of[a['id']] == key]
        usage = next((p for p in live['providers'] if p['providerId'] == key), {})
        signal = dict(usage, fetchedAt=epoch(live.get('fetchedAt')))
        signal['windows'] = [dict(w, resetsAt=epoch(w.get('resetsAt')))
                             for w in windows_with_a_limit(key, usage.get('windows', []))]
        providers[key] = decide(signal, previous.get('providers', {}).get(key, {}), now, provider=key,
                                agents=len(slots_in_use[key]), config=pacing)
    gate = {'updated_at': now, 'providers': providers, 'stopped': read_json(data_dir / 'stopped.json', previous.get('stopped', {})),
            'enforcement_error': error}
    write_json(gate_path, gate)
    held_before = set(gate['stopped'])
    stop_queue = stop_order(live_crew, parent_of, provider_of, {key: p['cap'] for key, p in providers.items()}, created_at)
    for agent_id in resumed_agent_ids(gate['stopped'], live['agents'], {a['id'] for a in stop_queue}):
        del gate['stopped'][agent_id]
    labelled, requested_stops = set(), {}
    for agent in stop_queue:
        if time.time() - now > 100:
            gate['enforcement_error'] = 'Interruption deadline reached; remaining crew enforcement unverified'
            break
        if agent['id'] in waiting_ids([a for a in live_crew if a['id'] not in requested_stops], parent_of):
            continue
        key = provider_of[agent['id']]
        set_hold_label(cli, config['paseo_home'], agent['id'], key)
        labelled.add(agent['id'])
        try:
            result = subprocess.run([cli, 'stop', agent['id'], '--home', config['paseo_home'], '--json'],
                                    capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError):
            gate['enforcement_error'] = 'Managed crew interruption unavailable or timed out'
            continue
        if result.returncode:
            gate['enforcement_error'] = 'Managed crew interruption failed'
            continue
        acknowledgement = json.loads(result.stdout)
        if agent['id'] not in acknowledgement.get('agentIds', []) or acknowledgement.get('stoppedCount', 0) < 1:
            gate['enforcement_error'] = 'Managed crew interruption unverified; CLI did not acknowledge target'
            continue
        requested_stops[agent['id']] = key
    if requested_stops:
        try:
            verified, _ = snapshot(config)
            live = verified
            by_id = {a['id']: a for a in verified['agents']}
            for agent_id, key in requested_stops.items():
                if by_id.get(agent_id, {}).get('status') == 'idle':
                    gate['stopped'][agent_id] = {'provider': key, 'at': now}
                else:
                    gate['enforcement_error'] = 'Managed crew interruption unverified; retry next watch'
        except (RuntimeError, ValueError, subprocess.SubprocessError, OSError):
            gate['enforcement_error'] = 'Managed crew interruption unverified; lifecycle read failed'
    for agent_id in stale_hold_ids(live['agents'], labelled, gate['stopped']):
        clear_hold_label(cli, config['paseo_home'], agent_id)
    new_holds = {agent_id: gate['stopped'][agent_id]['provider'] for agent_id in labelled
                 if agent_id in gate['stopped'] and agent_id not in held_before}
    if new_holds:
        tell_parents(cli, config['paseo_home'], new_holds, live['agents'], {a['id'] for a in crew}, providers)
    write_json(data_dir / 'stopped.json', gate['stopped'])
    write_json(gate_path, gate)
    if check:
        provider = providers[check]
        check_live_crew = [a for a in managed_agents(live['agents'], config, overridden)
                         if a['status'] in LIVE]
        check_slots = [a for a in working_agents(check_live_crew, parents_by_id(live['agents']))
                       if provider_key(a, live['bases']) == check]
        active = len(check_slots)
        requester_will_wait = any(a['id'] == os.environ.get('PASEO_AGENT_ID') for a in check_slots)
        interruption = gate['stopped'].get(target)
        interrupted = bool(interruption and interruption['at'] >= started_at)
        override = task in overridden
        allowed = override or (not interrupted and not gate['enforcement_error'] and provider['cap'] > 0
                               and active + (max(0, slots - 1) if requester_will_wait else slots) <= provider['cap'])
        print(json.dumps({'provider': check, 'allowed': allowed, 'cap': provider['cap'], 'active': active,
                          'target_interrupted': interrupted, 'override': override}))
        return 0 if allowed else 2
    if bootstrap:
        if gate['enforcement_error']:
            print(gate['enforcement_error'], file=sys.stderr)
            if snapshot_failure:
                print(snapshot_failure, file=sys.stderr)
            return 1
        return 0
    summary = {'providers': {key: {'cap': v['cap'], 'mode': v['mode'], 'reason': v['reason']}
                            for key, v in providers.items()},
               'stopped': sorted(gate['stopped']), 'enforcement_error': gate['enforcement_error']}
    marker = watch_state / 'last-notice.json'
    old_notice = read_json(marker, None)
    write_json(marker, summary)
    if gate['enforcement_error'] and gate['enforcement_error'] != (old_notice or {}).get('enforcement_error'):
        print(gate['enforcement_error'], file=sys.stderr)
    print_pace_alerts(providers, watch_state / 'pace-alerts.json', now)
    if (not bootstrap and old_notice is not None and without_reasons(summary) != without_reasons(old_notice)
            and (crew_was_running or summary['stopped'] != old_notice.get('stopped'))):
        print('Subscription guard changed: ' + json.dumps(summary, sort_keys=True))
    return 1 if gate['enforcement_error'] else 0


def print_pace_alerts(providers, seen_path, now):
    lines, seen = pace_alerts(providers, read_json(seen_path, {}), now)
    write_json(seen_path, seen)
    if lines:
        print('Subscription pace alert: a weekly window is forecast to end its week at 85% or more (the hard stop is 90%).')
        print('\n'.join('- ' + line for line in lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--check', choices=('claude', 'codex'))
    parser.add_argument('--slots', type=int, default=1)
    parser.add_argument('--target-agent')
    parser.add_argument('--turn-started-at', type=float, default=0)
    parser.add_argument('--task', help='task id; an active override for it admits the check')
    parser.add_argument('--override', metavar='TASK', help='let TASK bypass the guard for --hours (0 removes)')
    parser.add_argument('--hours', type=float)
    args = parser.parse_args()
    if not math.isfinite(args.turn_started_at) or args.turn_started_at < 0:
        parser.error('--turn-started-at must be a nonnegative finite epoch')
    if args.slots < 0:
        parser.error('--slots must be nonnegative')
    data_dir = state_dir()
    if args.override:
        if args.hours is None or not math.isfinite(args.hours) or args.hours < 0:
            parser.error('--override needs --hours, a nonnegative number')
        return set_override(data_dir, args.override, args.hours)
    state = Path(os.environ.get('USAGE_PACER_NOTICE_STATE', str(data_dir / 'watch-state')))
    try:
        return run(data_dir, state, args.bootstrap, args.check, args.slots, args.target_agent, args.turn_started_at,
                   args.task)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        gate_path = data_dir / 'gate.json'
        try:
            stopped = read_json(gate_path.parent / 'stopped.json', {})
        except (OSError, ValueError):
            stopped = {}
        write_json(gate_path, {'updated_at': time.time(), 'providers': {}, 'stopped': stopped,
                              'enforcement_error': 'Guard failed; dispatch closed; active enforcement unverified'})
        print('Subscription guard failed; dispatch closed; inspect installation and daemon', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
