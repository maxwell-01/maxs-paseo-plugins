"""The pacing controller the usage guard calls: given one usage window's live signal and the guard's
readings so far, recommend a concurrency. Slow to scale up, fast to scale down, and fail-safe when no
fresh signal exists. policy.py feeds each window through the five-hour inputs or the weekly ones.
"""

import json
import math
import os
import time

# One concurrency step down per this many percentage points of projected
# overshoot beyond a window's ceiling. Coarse on purpose: scaling DOWN harder
# than strictly needed is always safe, so this needs no tuning knob. Guarantees
# at least one step down whenever a scale-down fires.
DOWN_STEP_PER_PCT = 10.0

# Burn is fitted over the samples from the last fifth of a window's time to
# reset: long enough that one tick of a percent cannot fake a trend in the
# 7-day window, short enough that a short window reacts within minutes.
LOOKBACK_SHARE_OF_TIME_TO_RESET = 0.2
MIN_LOOKBACK_MIN = 60
MAX_LOOKBACK_MIN = 1440

# A window must be sampled this long before its burn can size the cap or
# scale it down; a shorter stretch is one or two ticks of a percent.
MIN_MEASURE_MIN = 20

# The crew must have run this many agent-minutes before its burn can size the
# cap; fewer leave the rise to burn the crew did not cause.
MIN_CREW_AGENT_MIN = 60
SUSTAIN_MIN = 20


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def agents_at(rec):
    """Agents running from this record to the next. A caller without its own
    count (a workflow pacing itself) runs exactly its recorded concurrency."""
    return rec["agents"] if "agents" in rec else rec.get("concurrency")


def since_last_reset(points):
    """The (ts, pct, ...) points after the last drop in pct, oldest first."""
    resets = [i for i in range(1, len(points)) if points[i][1] < points[i - 1][1]]
    return points[resets[-1]:] if resets else points


def window_measured(telemetry, pct_key, now):
    points = since_last_reset([(rec["ts"], rec[pct_key]) for rec in telemetry
                               if rec.get("ts") is not None and rec.get(pct_key) is not None])
    return bool(points) and (now - points[0][0]) / 60.0 >= MIN_MEASURE_MIN


def crew_burn(telemetry, pct_key, live_pct, now, lookback_min):
    points = [(rec["ts"], rec[pct_key], agents_at(rec)) for rec in telemetry
              if rec.get("ts") is not None and rec.get(pct_key) is not None
              and isinstance(agents_at(rec), int) and 0 < now - rec["ts"] <= lookback_min * 60]
    points = since_last_reset(points)
    if not points or live_pct < points[-1][1] or (now - points[0][0]) / 60.0 < MIN_MEASURE_MIN:
        return None
    ends = [(t, pct) for t, pct, _ in points[1:]] + [(now, live_pct)]
    spans = [(agents, (end - t) / 60.0, end_pct - pct)
             for (t, pct, agents), (end, end_pct) in zip(points, ends)]
    agent_minutes = sum(agents * minutes for agents, minutes, _ in spans)
    if agent_minutes < MIN_CREW_AGENT_MIN:
        return None
    time_squared = sum(minutes ** 2 for _, minutes, _ in spans)
    crew_time_squared = sum(agents * minutes ** 2 for agents, minutes, _ in spans)
    agent_time_squared = sum((agents * minutes) ** 2 for agents, minutes, _ in spans)
    time_rise = sum(minutes * rise for _, minutes, rise in spans)
    agent_time_rise = sum(agents * minutes * rise for agents, minutes, rise in spans)
    spread = time_squared * agent_time_squared - crew_time_squared ** 2
    has_crew_variation = len({agents for agents, _, _ in spans}) > 1
    baseline = max(0.0, (time_rise * agent_time_squared - agent_time_rise * crew_time_squared)
                   / spread) if has_crew_variation and spread > 0 else 0.0
    crew_rise = sum(rise - baseline * minutes for agents, minutes, rise in spans if agents > 0)
    if crew_rise <= 0:
        return None
    return baseline, crew_rise / agent_minutes


def agent_cap(measured_burn, allowed_burn, min_c, max_c, running):
    baseline, per_agent = measured_burn
    return clamp(max(running, math.floor((allowed_burn - baseline) / per_agent)), min_c, max_c)


def read_sharing():
    """Return "on" or "off" from ~/.claude/paced-workflows/sharing.json. Never
    raises. Absent/unreadable/unparseable => "on" (absence = normal operation;
    the toggle is an override, so a missing/corrupt file must not pause work)."""
    try:
        path = os.path.expanduser("~/.claude/paced-workflows/sharing.json")
        with open(path) as f:
            return "off" if json.load(f).get("sharing") == "off" else "on"
    except Exception:
        return "on"


def recommend(cfg, signal, telemetry, current_concurrency_arg=None, now=None, agents=None):
    start_concurrency = cfg["start_concurrency"]
    min_c = cfg["min_concurrency"]
    max_c = cfg["max_concurrency"]
    start_effort = cfg["start_effort"]
    max_effort = cfg["max_builder_effort"]
    observe_minutes = cfg["observe_minutes"]
    up_step = cfg["up_step"]
    up_cooldown_min = cfg["up_cooldown_min"]
    up_margin_pct = cfg["up_margin_pct"]
    emergency_5h = cfg["emergency_5h_pct"]
    emergency_7d = cfg["emergency_7d_pct"]
    ceiling_5h = 100 - cfg["contingency_5h_pct"]
    ceiling_7d = 100 - cfg["contingency_7d_pct"]
    proj_horizon_min = cfg.get("proj_horizon_min", 720)

    five = signal.get("five_h_pct")
    seven = signal.get("seven_d_pct")
    source = signal.get("source")
    fresh = signal.get("signal_fresh")
    now = time.time() if now is None else now

    # Current concurrency: trust the caller's --current-concurrency; else infer
    # from the last telemetry record; else fall back to the start pace.
    current_concurrency = current_concurrency_arg
    if current_concurrency is None:
        for rec in reversed(telemetry):
            if isinstance(rec.get("concurrency"), int):
                current_concurrency = rec["concurrency"]
                break
    if current_concurrency is None:
        current_concurrency = start_concurrency

    running = agents if isinstance(agents, int) else next(
        (agents_at(rec) for rec in reversed(telemetry) if isinstance(agents_at(rec), int)),
        current_concurrency)

    # Run elapsed, from the first telemetry line of this run — used ONLY for the
    # observation gate, not for burn (burn uses a recent window; see below).
    run_start_ts = None
    for rec in telemetry:
        if rec.get("ts") is not None:
            run_start_ts = rec["ts"]
            break
    run_elapsed_min = round((now - run_start_ts) / 60.0, 1) if run_start_ts else 0.0

    def signals(burn5=None, burn7=None, proj5=None, proj7=None):
        return {
            "five_h_pct": five, "seven_d_pct": seven,
            "burn_rate_pct_per_min": burn5, "burn_rate_7d_pct_per_min": burn7,
            "projected_5h_at_reset": proj5, "projected_7d_at_reset": proj7,
            "headroom_5h": (round(ceiling_5h - five, 1) if five is not None else None),
            "source": source, "elapsed_min": run_elapsed_min,
        }

    def effort_for(concurrency, floored=False):
        # "low" at/approaching the floor; otherwise the start effort. May rise
        # to "high" ONLY if config explicitly allows it (default caps at medium),
        # so the controller never silently spends more thinking than permitted.
        want = "low" if (floored or concurrency <= min_c) else start_effort
        order = {"low": 0, "medium": 1, "high": 2}
        if order.get(want, 1) > order.get(max_effort, 1):
            want = max_effort
        return want

    # 0) USAGE SHARING OFF — the user has turned budget sharing off for now, so no
    #    workflow may consume their usage. Pause at the minimum pace and lowest
    #    effort; callers honour "paused" by not starting new work and resuming
    #    when they flip it back on. Checked FIRST, before the fail-safe.
    if read_sharing() == "off":
        return {
            "concurrency": min_c,
            "builder_effort": "low",
            "action": "paused",
            "reason": "usage sharing is off in ~/.claude/paced-workflows/sharing.json",
            "signals": signals(),
        }

    # 1) FAIL SAFE — no fresh LIVE signal => start pace, floor. Never scale up
    #    without a fresh live reading; a stale/absent signal must not raise burn.
    if source != "live" or not fresh or seven is None:
        return {
            "concurrency": start_concurrency,
            "builder_effort": effort_for(start_concurrency),
            "action": "floor",
            "reason": f"no fresh live signal (source={source}, fresh={fresh}, 7d={seven}); "
                      f"holding start pace, will not scale up blind",
            "signals": signals(),
        }

    # 2) HARD FLOOR — any reported window at/over its emergency ceiling => min
    #    pace, lowest effort. The tighter one binds.
    tripped = [f"{name}={pct}% (>= {limit})" for name, pct, limit in
               (("5h", five, emergency_5h), ("7d", seven, emergency_7d))
               if pct is not None and pct >= limit]
    if tripped:
        return {
            "concurrency": min_c,
            "builder_effort": effort_for(min_c, floored=True),
            "action": "floor",
            "reason": f"emergency floor: {', '.join(tripped)}; minimum pace",
            "signals": signals(),
        }

    # A falling fit means a window reset or noise, so burn clamps to 0, never
    # negative. Each window is measured and projected independently.
    def lookback_min(reset_epoch):
        minutes_to_reset = (reset_epoch - now) / 60.0 if reset_epoch else 0.0
        return clamp(minutes_to_reset * LOOKBACK_SHARE_OF_TIME_TO_RESET,
                     MIN_LOOKBACK_MIN, MAX_LOOKBACK_MIN)

    def recent_burn(pct_key, live_pct, reset_epoch):
        if live_pct is None:
            return None
        prior = [(rec["ts"], rec[pct_key]) for rec in telemetry
                 if rec.get("ts") is not None and rec.get(pct_key) is not None and rec["ts"] < now]
        if not prior:
            return None
        points = [p for p in prior if now - p[0] <= lookback_min(reset_epoch) * 60] or prior[-1:]
        points.append((now, live_pct))
        mean_t = sum(t for t, _ in points) / len(points)
        mean_pct = sum(pct for _, pct in points) / len(points)
        spread = sum((t - mean_t) ** 2 for t, _ in points)
        slope_per_s = sum((t - mean_t) * (pct - mean_pct) for t, pct in points) / spread
        return max(0.0, round(slope_per_s * 60, 4))

    sustain_start = now - SUSTAIN_MIN * 60
    boundary_agent = next((agents_at(rec) for rec in reversed(telemetry)
                           if rec.get("ts", now) <= sustain_start), 0)
    recent_agents = [boundary_agent] + [agents_at(rec) for rec in telemetry
                                       if sustain_start < rec.get("ts", 0) <= now]
    sustained = min([running] + [count if isinstance(count, int) else 0 for count in recent_agents])
    measured5 = crew_burn(telemetry, "five_h_pct", five, now,
                          lookback_min(signal.get("five_h_reset_epoch"))) if five is not None else None
    measured7 = crew_burn(telemetry, "seven_d_pct", seven, now,
                          lookback_min(signal.get("seven_d_reset_epoch")))
    burn5 = (measured5[0] + measured5[1] * sustained) if measured5 else recent_burn(
        "five_h_pct", five, signal.get("five_h_reset_epoch"))
    burn7 = (measured7[0] + measured7[1] * sustained) if measured7 else recent_burn(
        "seven_d_pct", seven, signal.get("seven_d_reset_epoch"))

    def minutes_ahead(reset_epoch):
        return max(0.0, min(proj_horizon_min, (reset_epoch - now) / 60.0))

    def project(current_pct, burn, reset_epoch):
        if burn is None or reset_epoch is None or current_pct is None:
            return None  # can't project => treated as "not proven safe" below
        return round(current_pct + burn * minutes_ahead(reset_epoch), 1)

    # The agents whose measured burn lands the window on its ceiling at reset;
    # None until the fleet has been measured in this window.
    def sized_cap(measured, live_pct, reset_epoch, ceiling):
        if live_pct is None or reset_epoch is None or not minutes_ahead(reset_epoch):
            return None
        if measured is None:
            return None
        return agent_cap(measured, (ceiling - live_pct) / minutes_ahead(reset_epoch), min_c, max_c, running)

    proj5 = project(five, burn5, signal.get("five_h_reset_epoch"))
    proj7 = project(seven, burn7, signal.get("seven_d_reset_epoch"))
    # A supplied projection is not a linear burn, so it has no per-agent rate
    # to size from and keeps the one-step climb.
    paced = "paced_projection_pct" in signal
    raise_limit_5h, raise_limit_7d = ceiling_5h - up_margin_pct, ceiling_7d - up_margin_pct
    if paced:
        proj5 = proj7 = signal["paced_projection_pct"]
    if paced and "raise_below_pct" in signal:
        raise_limit_5h = raise_limit_7d = signal["raise_below_pct"]
    sizes = [] if paced else [
        c for c in (sized_cap(measured5, five, signal.get("five_h_reset_epoch"), ceiling_5h),
                    sized_cap(measured7, seven, signal.get("seven_d_reset_epoch"), ceiling_7d))
        if c is not None]
    sized = min(sizes) if sizes else None
    sig = signals(burn5=burn5, burn7=burn7, proj5=proj5, proj7=proj7)

    # 5a) SCALE DOWN (checked first — down beats up, and it may fire even during
    #     the observation window). Trigger if trajectory would breach a ceiling,
    #     or we are already inside a contingency reserve.
    #     A projection counts only once its window has been measured, and one
    #     drop at most halves the cap, so a burst just after a reset cannot
    #     floor it.
    evidenced5 = proj5 if paced or window_measured(telemetry, "five_h_pct", now) else None
    evidenced7 = proj7 if paced or window_measured(telemetry, "seven_d_pct", now) else None
    over_trajectory = (evidenced5 is not None and evidenced5 > ceiling_5h) or \
                      (evidenced7 is not None and evidenced7 > ceiling_7d)
    within_reserve = (five is not None and five > ceiling_5h) or seven > ceiling_7d
    if over_trajectory or within_reserve:
        excess = 0.0
        for value, ceiling in ((evidenced5, ceiling_5h), (evidenced7, ceiling_7d),
                               (five, ceiling_5h), (seven, ceiling_7d)):
            if value is not None:
                excess = max(excess, value - ceiling)
        steps_down = max(1, math.ceil(excess / DOWN_STEP_PER_PCT))
        new_c = clamp(max(current_concurrency - steps_down, math.ceil(current_concurrency / 2)),
                      min_c, max_c)
        safely_below_ceiling = (five is None or five < ceiling_5h - up_margin_pct) and \
            seven < ceiling_7d - up_margin_pct
        if safely_below_ceiling:
            new_c = clamp(max(new_c, running), min_c, max_c)
        return {
            "concurrency": new_c,
            "builder_effort": effort_for(new_c),
            "action": "scale_down" if new_c < current_concurrency else "hold",
            "reason": f"trajectory/reserve breach (proj5={proj5}, proj7={proj7}, "
                      f"5h={five}%, 7d={seven}%; ceilings {ceiling_5h}/{ceiling_7d}); "
                      f"dispatch cap {new_c}",
            "signals": sig,
        }

    # 3) OBSERVATION — before observe_minutes we have too little of THIS run's
    #    data to justify raising burn. Hold at start pace (scale-down above still
    #    applied if trending bad). First call (elapsed 0) lands here.
    if run_elapsed_min < observe_minutes:
        return {
            "concurrency": start_concurrency,
            "builder_effort": effort_for(start_concurrency),
            "action": "hold",
            "reason": f"observing ({run_elapsed_min:.0f}/{observe_minutes} min); "
                      f"holding start pace before any scale-up",
            "signals": sig,
        }

    # 3b) SIZE DOWN — the measured fleet's burn supports fewer agents than the
    #     cap allows. Lowering is always safe, so no cooldown applies.
    if sized is not None and sized < current_concurrency:
        return {
            "concurrency": sized,
            "builder_effort": effort_for(sized),
            "action": "scale_down",
            "reason": f"measured burn per agent supports {sized} agents to the ceilings "
                      f"{ceiling_5h}/{ceiling_7d}; lowering from {current_concurrency}",
            "signals": sig,
        }

    # 5b) SCALE UP — only when every reported window's projection sits
    #     comfortably under its ceiling (with up_margin_pct of extra room) AND the
    #     cooldown since the last scale_up has elapsed. Requires real projections
    #     (fresh reset + measured burn); a missing projection of a reported
    #     window blocks the raise.
    comfortable = (
        (five is None or (proj5 is not None and proj5 < raise_limit_5h))
        and proj7 is not None and proj7 < raise_limit_7d
    )
    checked_windows = "7d window" if five is None else "both windows"
    checked_ceilings = "the 7d ceiling" if five is None else "both ceilings"
    checked_projections = f"proj7={proj7}<{raise_limit_7d}" if five is None else \
        f"proj5={proj5}<{raise_limit_5h}, proj7={proj7}<{raise_limit_7d}"
    last_change_ts = None
    prev_c = None
    for rec in telemetry:
        ts = rec.get("ts")
        c = rec.get("concurrency")
        if rec.get("action") in ("scale_up", "scale_down") and ts is not None:
            last_change_ts = ts
        elif isinstance(c, int) and isinstance(prev_c, int) and c != prev_c and ts is not None:
            last_change_ts = ts
        if isinstance(c, int):
            prev_c = c
    cooldown_ok = last_change_ts is None or (now - last_change_ts) / 60.0 >= up_cooldown_min

    crew_fills_cap = isinstance(agents, int) and agents >= current_concurrency
    climb = current_concurrency + up_step if paced or crew_fills_cap else None
    target = sized if sized is not None else climb
    if comfortable and cooldown_ok and target is not None:
        new_c = min(target, max_c)
        if new_c > current_concurrency:
            return {
                "concurrency": new_c,
                "builder_effort": effort_for(new_c),
                "action": "scale_up",
                "reason": f"{checked_windows} comfortably safe ({checked_projections}); "
                          f"raising to {new_c}",
                "signals": sig,
            }

    # ELSE HOLD — safe but not comfortably clear, or cooling down, or already at max.
    reason = "holding: "
    if not comfortable:
        reason += f"not comfortably clear of {checked_ceilings}"
    elif not cooldown_ok:
        reason += f"scale-up cooldown ({up_cooldown_min} min) not elapsed"
    elif target is None:
        reason += "no burn per agent measured yet and the crew does not fill the cap"
    else:
        reason += "already at the size the measured burn supports, or at max"
    return {
        "concurrency": clamp(current_concurrency, min_c, max_c),
        "builder_effort": effort_for(current_concurrency),
        "action": "hold",
        "reason": reason,
        "signals": sig,
    }
