ALERT_STEPS = (85, 90, 95)
BURN_LOOKBACK_SECONDS = 3 * 3600
MIN_BURN_SPAN_SECONDS = 20 * 60


def weekly_burn_per_hour(history, key, reset, now):
    period = [(rec['ts'], rec['windows'][key]['usedPct']) for rec in history
              if key in rec['windows'] and abs(rec['windows'][key]['resetsAt'] - reset) < 2
              and now - rec['ts'] <= BURN_LOOKBACK_SECONDS]
    if len(period) < 2 or period[-1][0] - period[0][0] < MIN_BURN_SPAN_SECONDS:
        return None
    (first_ts, first_pct), (last_ts, last_pct) = period[0], period[-1]
    return round((last_pct - first_pct) / ((last_ts - first_ts) / 3600), 1)


def step_reached(forecast):
    return max((step for step in ALERT_STEPS if forecast >= step), default=None)


def pace_alerts(providers, seen, now):
    lines, seen = [], dict(seen)
    for provider_key, decision in sorted(providers.items()):
        history = decision.get('history') or []
        if not history:
            continue
        for window_key, forecast in sorted(decision.get('projections', {}).items()):
            window = history[-1]['windows'].get(window_key)
            step = step_reached(forecast) if window_key.startswith('weekly') and forecast is not None else None
            if step is None or window is None:
                continue
            seen_key = f'{provider_key}/{window_key}'
            last = seen.get(seen_key)
            if last and abs(last['resetsAt'] - window['resetsAt']) < 2 and last['step'] >= step:
                continue
            seen[seen_key] = {'step': step, 'resetsAt': window['resetsAt']}
            burn = weekly_burn_per_hour(history, window_key, window['resetsAt'], now)
            burn_text = 'burn unknown' if burn is None else f'burning {burn}%/h'
            lines.append(f"{provider_key} {window_key}: forecast {forecast}% at reset (past {step}%), "
                         f"used {window['usedPct']}%, {burn_text}, "
                         f"{(window['resetsAt'] - now) / 3600:.1f} h to reset")
    return lines, seen
