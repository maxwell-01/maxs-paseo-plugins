import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import pace

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / 'pacing.json').read_text())
CONFIG.update(start_concurrency=1, min_concurrency=1, proj_horizon_min=1e9)
MAX_AGE = 300
HOLD_SECONDS = 900
STEP_DOWN_SECONDS = 300
RESET_GRACE = 1800
WEEK_SECONDS = 7 * 86400
WORKING_WEEKDAYS = 5


def valid_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def worked_seconds(start, end):
    total = 0
    day = datetime.fromtimestamp(start).replace(hour=0, minute=0, second=0, microsecond=0)
    while day.timestamp() < end:
        following = day + timedelta(days=1)
        if day.weekday() < WORKING_WEEKDAYS:
            total += max(0, min(end, following.timestamp()) - max(start, day.timestamp()))
        day = following
    return total


def working_fraction(start, end, now):
    return worked_seconds(start, min(now, end)) / worked_seconds(start, end)


def whole_fraction(start, end, now):
    return (min(now, end) - start) / (end - start)


WEEKLY_PACE_FRACTIONS = {'working_week': working_fraction, 'whole_week': whole_fraction}
OVERRIDABLE_PERCENTS = {'weekly_target_pct', 'contingency_5h_pct', 'contingency_7d_pct', 'emergency_5h_pct',
                        'emergency_7d_pct', 'up_margin_pct', 'stop_pct'}


def valid_override(key, value):
    if key == 'weekly_pace':
        return value in WEEKLY_PACE_FRACTIONS
    if key == 'max_concurrency':
        return isinstance(value, int) and not isinstance(value, bool) and value >= 1
    return key in OVERRIDABLE_PERCENTS and valid_number(value) and 0 <= value <= 100


def with_overrides(overrides):
    if not isinstance(overrides, dict):
        raise ValueError('pacing overrides must be a JSON object')
    for key, value in overrides.items():
        if not valid_override(key, value):
            raise ValueError(f'invalid pacing override {key}={value!r}')
    return dict(CONFIG, **overrides)


def reading_problem(data, now, known_windows):
    stamp = data.get('fetchedAt')
    windows = data.get('windows', [])
    if data.get('status') != 'available' or not valid_number(stamp) or not 0 <= now - stamp <= MAX_AGE:
        return 'invalid or stale usage'
    if not windows or any(not isinstance(w, dict) or not isinstance(w.get('id'), str)
                          or not valid_number(w.get('usedPct')) or not 0 <= w['usedPct'] <= 100
                          or not valid_number(w.get('resetsAt')) or w['resetsAt'] <= now - RESET_GRACE for w in windows):
        return 'invalid or stale usage'
    ids = {w['id'] for w in windows}
    if len(ids) != len(windows):
        return 'duplicate window ids'
    if 'weekly' in known_windows and 'weekly' not in ids:
        return 'weekly window disappeared'
    return None


def mode_for(cap):
    return 'paused' if cap == 0 else 'throttled' if cap == 1 else 'paced'


def hold_last_decision(previous, now, problem):
    history = previous.get('history', [])
    if not history:
        return dict(previous, cap=0, mode='paused', reason=problem, projections={}, history=[])
    last_good = history[-1]
    gap = now - last_good['ts']
    steps_down = 0 if gap <= HOLD_SECONDS else 1 + int((gap - HOLD_SECONDS) // STEP_DOWN_SECONDS)
    last_cap = 0 if previous.get('mode') == 'paused' else last_good['cap']
    cap = max(min(1, last_cap), last_cap - steps_down)
    return dict(previous, cap=cap, mode=mode_for(cap), reason=f'{problem}; holding last good reading',
                last_good_age_min=round(gap / 60))


def period_ended(prior, current, now):
    return prior['resetsAt'] <= now or (
        prior['resetsAt'] < current['resetsAt'] - 2 and prior['resetsAt'] - now <= RESET_GRACE)


def previous_period_burn(history, current, now):
    key = current['id']
    finished = [(rec['ts'], rec['windows'][key]) for rec in history
                if key in rec['windows'] and rec['ts'] < rec['windows'][key]['resetsAt']
                and period_ended(rec['windows'][key], current, now)]
    if not finished:
        return None
    last_reset = finished[-1][1]['resetsAt']
    period = [(ts, w['usedPct']) for ts, w in finished if abs(w['resetsAt'] - last_reset) < 2]
    if len(period) < 2:
        return None
    (first_ts, first_pct), (last_ts, last_pct) = period[0], period[-1]
    return max(0.0, (last_pct - first_pct) / (last_ts - first_ts))


def window_reason(key, projection, raise_limit, recommendation):
    forecast = 'unknown' if projection is None else f'{projection}%'
    return f"{key} forecast {forecast} vs raise limit {raise_limit}%: {recommendation['reason']}"


def decide(data, previous, now, provider='claude', agents=None, config=CONFIG):
    known_windows = previous.get('known_windows', [])
    problem = reading_problem(data, now, known_windows)
    if problem:
        return hold_last_decision(previous, now, problem)
    stamp = data['fetchedAt']
    windows = data['windows']
    ids = {w['id'] for w in windows}
    result = {'cap': 0, 'mode': 'paused', 'reason': '', 'projections': {},
              'fetched_at': stamp, 'history': [], 'known_windows': sorted(ids)}
    windows = [dict(w, usedPct=0) if w['resetsAt'] <= now else w for w in windows]
    history = previous.get('history', [])
    history = [rec for rec in history if now - rec['ts'] <= 86400]
    current = max(1, previous.get('cap', 1))
    caps = []
    raise_limit = 100 - max(config['contingency_5h_pct'], config['contingency_7d_pct']) - config['up_margin_pct']
    measure_observation_config = dict(config, observe_minutes=pace.MIN_MEASURE_MIN)
    for window in windows:
        key, pct, reset = window['id'], window['usedPct'], window['resetsAt']
        records = []
        for rec in history:
            prior = rec['windows'].get(key)
            idle_codex_period = (provider == 'codex' and prior and prior['usedPct'] == pct == 0
                                 and now < prior['resetsAt'] <= reset)
            same_period = prior and (idle_codex_period or (
                abs(prior['resetsAt'] - reset) < 2 and prior['usedPct'] <= pct))
            if same_period or prior and period_ended(prior, window, now):
                if rec['ts'] >= stamp:
                    continue
                burn_pct = prior['usedPct'] if same_period else None
                records.append({'ts': rec['ts'], 'five_h_pct': burn_pct, 'seven_d_pct': burn_pct,
                                'concurrency': rec['cap'], 'agents': rec.get('agents'), 'action': rec['action']})
            else:
                records = []
        signal = {'source': 'live', 'signal_fresh': True, 'five_h_pct': pct, 'seven_d_pct': pct,
                  'five_h_reset_epoch': reset, 'seven_d_reset_epoch': reset}
        weekly_kind = key.startswith('weekly')
        if weekly_kind:
            fraction = WEEKLY_PACE_FRACTIONS[config['weekly_pace']](reset - WEEK_SECONDS, reset, stamp)
            target = config['weekly_target_pct']
            margin = config['up_margin_pct']
            ceiling = 100 - config['contingency_7d_pct']
            pace_limit = target * fraction + margin
            ahead = pct > pace_limit
            projection = round(pct / fraction, 1) if fraction else None
            forecast = pct / fraction if fraction else 0 if pct == 0 else target
            signal['paced_projection_pct'] = ceiling + 1 if ahead else min(forecast, target)
            signal['raise_below_pct'] = target
        elif reset > stamp and not pace.window_measured(records, 'five_h_pct', stamp):
            carried_burn = previous_period_burn(history, window, now)
            if carried_burn is not None:
                signal['paced_projection_pct'] = round(pct + carried_burn * (reset - stamp), 1)
        recommendation = pace.recommend(measure_observation_config, signal, records, current, now=stamp, agents=agents)
        if not weekly_kind:
            projection = recommendation['signals'].get('projected_5h_at_reset')
        result['projections'][key] = projection
        if weekly_kind and ahead:
            caps.append((1, f'{key} {pct}% is over its pace limit {pace_limit:.1f}%: capped at 1'))
        else:
            caps.append((recommendation['concurrency'],
                         window_reason(key, projection, signal.get('raise_below_pct', raise_limit),
                                       recommendation)))
    high = any(w['usedPct'] >= config['stop_pct'] for w in windows)
    sharing_off = pace.read_sharing() == 'off'
    if high or sharing_off:
        result['reason'] = f"actual usage >={config['stop_pct']}%" if high else 'usage sharing off'
    else:
        cap = min(window_cap for window_cap, _ in caps)
        reason = '; '.join(text for window_cap, text in caps if window_cap == cap)
        has_weekly = 'weekly' in ids
        unproven = any(v is None for k, v in result['projections'].items() if not k.startswith('weekly'))
        observed = history and stamp - history[0]['ts'] >= config['observe_minutes'] * 60
        if observed and isinstance(agents, int) and all(
                w['usedPct'] < config['stop_pct'] - config['up_margin_pct'] for w in windows):
            kept_agents = min(agents, config['max_concurrency'])
            if kept_agents > cap:
                cap, reason = kept_agents, f'keeping {kept_agents} working agents; {reason}'
        if previous.get('mode') == 'paused':
            cap, reason = 1, 'resuming from a pause'
        if not has_weekly or unproven:
            cap, reason = 1, 'no weekly window' if not has_weekly else 'short-window forecast unknown'
        if history and stamp <= history[-1]['ts']:
            cap, reason = previous.get('cap', 1), previous.get('reason', reason)
        result.update(cap=cap, mode=mode_for(cap), reason=reason)
    if not history or stamp > history[-1]['ts']:
        history.append({'ts': stamp, 'windows': {w['id']: w for w in windows}, 'cap': result['cap'],
                        'agents': agents, 'action': 'scale_up' if result['cap'] > previous.get('cap', 1) else 'hold'})
    result['history'] = history
    return result
