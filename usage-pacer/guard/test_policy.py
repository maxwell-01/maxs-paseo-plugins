import importlib.util
import os
import time
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('policy', HERE / 'policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

NOW = 1800000000

os.environ['TZ'] = 'UTC'
time.tzset()

DAY = 86400
MONDAY_RESET = 1791763200
WINDOW_START = MONDAY_RESET - 7 * DAY
MID_WEEK_RESET = NOW + 302400
WEDNESDAY_NOON = WINDOW_START + 2.5 * DAY


def reading(pct=20, weekly=True, stamp=NOW, reset=NOW + 3600):
    windows = [{'id': 'session', 'usedPct': pct, 'resetsAt': reset}]
    if weekly:
        windows.append({'id': 'weekly', 'usedPct': pct, 'resetsAt': MID_WEEK_RESET})
    return {'status': 'available', 'fetchedAt': stamp, 'windows': windows}


def split_reading(session, at, reset, weekly=20):
    return {'status': 'available', 'fetchedAt': at, 'windows': [
        {'id': 'session', 'usedPct': session, 'resetsAt': reset},
        {'id': 'weekly', 'usedPct': weekly, 'resetsAt': MID_WEEK_RESET}]}


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.clock = patch.object(policy.pace.time, 'time', return_value=NOW)
        self.clock.start()
        self.sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        self.sharing.start()
        self.addCleanup(self.clock.stop)
        self.addCleanup(self.sharing.stop)

    def test_startup_high_pauses_without_history(self):
        self.assertEqual(policy.decide(reading(90), {}, NOW)['cap'], 0)

    def test_startup_low_is_one(self):
        self.assertEqual(policy.decide(reading(), {}, NOW)['cap'], 1)

    def test_stale_invalid_missing_pause(self):
        for data in (reading(stamp=NOW - 301), reading(float('nan')), {}, reading(reset=NOW - 1801)):
            with self.subTest(data=data):
                self.assertEqual(policy.decide(data, {}, NOW)['cap'], 0)

    def test_reset_does_not_turn_drop_into_zero_burn(self):
        prior = policy.decide(reading(91, stamp=NOW - 180), {}, NOW - 180)
        result = policy.decide(reading(1, reset=NOW + 18000), prior, NOW)
        self.assertEqual(result['cap'], 1)
        self.assertIsNone(result['projections']['session'])

    def test_missing_weekly_never_scales_up(self):
        state = {}
        for offset in range(0, 5400, 180):
            at = NOW + offset
            with patch.object(policy.pace.time, 'time', return_value=at):
                state = policy.decide(reading(10, weekly=False, stamp=at, reset=at + 3600), state, at)
        self.assertEqual(state['cap'], 1)

    def test_codex_single_weekly_is_complete_and_forecasts_supplied_reset(self):
        state = {}
        for offset in range(0, 3600, 180):
            at = NOW + offset
            data = {'status': 'available', 'fetchedAt': at, 'windows': [
                {'id': 'weekly', 'usedPct': 20, 'resetsAt': MID_WEEK_RESET}]}
            state = policy.decide(data, state, at, provider='codex')
        self.assertEqual(state['cap'], 3)
        self.assertEqual(state['projections'], {'weekly': 28.3})
        self.assertNotEqual(state['reason'], 'no weekly window')

    def test_idle_codex_forward_reset_builds_evidence_and_climbs(self):
        state, caps = {}, []
        for minute in range(0, 91, 6):
            at = NOW + minute * 60
            data = {'status': 'available', 'fetchedAt': at, 'windows': [
                {'id': 'weekly', 'usedPct': 0, 'resetsAt': at + 7 * DAY}]}
            state = policy.decide(data, state, at, provider='codex', agents=0)
            caps.append(state['cap'])
        self.assertEqual(caps, [1] * 4 + [2] * 4 + [3] * 4 + [4] * 4)
        repeated = policy.decide(data, state, at + 60, provider='codex', agents=0)
        self.assertEqual(repeated['cap'], 4)
        self.assertEqual(repeated['history'], state['history'])

    def test_backward_or_nonzero_codex_resets_do_not_build_evidence(self):
        for pct, direction in ((0, -1), (1, 1)):
            state = {}
            for minute in range(0, 91, 6):
                at = NOW + minute * 60
                data = {'status': 'available', 'fetchedAt': at, 'windows': [
                    {'id': 'weekly', 'usedPct': pct, 'resetsAt': MID_WEEK_RESET + direction * minute * 60}]}
                state = policy.decide(data, state, at, provider='codex', agents=0)
                self.assertEqual(state['cap'], 1, (pct, direction, minute))

    def test_falling_codex_usage_with_a_forward_reset_does_not_build_evidence(self):
        state = {}
        for minute in range(0, 91, 6):
            at = NOW + minute * 60
            data = {'status': 'available', 'fetchedAt': at, 'windows': [
                {'id': 'weekly', 'usedPct': 2 if minute < 90 else 1, 'resetsAt': MID_WEEK_RESET + minute * 60}]}
            state = policy.decide(data, state, at, provider='codex', agents=0)
        self.assertEqual(state['cap'], 1)

    def test_forward_reset_exception_does_not_apply_to_claude(self):
        state = {}
        for minute in range(0, 91, 6):
            at = NOW + minute * 60
            data = reading(0, stamp=at, reset=NOW + 18000)
            data['windows'][1]['resetsAt'] = MID_WEEK_RESET + minute * 60
            state = policy.decide(data, state, at, agents=0)
            self.assertEqual(state['cap'], 1)

    def test_long_gap_keeps_measuring_from_history(self):
        state = policy.decide(reading(), {}, NOW)
        later = NOW + 10000
        with patch.object(policy.pace.time, 'time', return_value=later):
            result = policy.decide(reading(stamp=later, reset=later + 3600), state, later)
        self.assertEqual(result['cap'], 1)
        self.assertEqual(result['projections']['weekly'], 27.7)

    def test_repeated_cached_sample_does_not_erase_measured_burn(self):
        first = policy.decide(reading(10, stamp=NOW - 180), {}, NOW - 180)
        second = policy.decide(reading(11), first, NOW)
        third = policy.decide(reading(11), second, NOW + 60)
        self.assertEqual(third['projections']['weekly'], second['projections']['weekly'])

    def climbing(self, until, agents=2):
        state, caps = {}, []
        for offset in range(0, until, 180):
            at = NOW + offset
            data = reading(offset / 600, stamp=at, reset=NOW + 18000)
            state = policy.decide(data, state, at, agents=agents)
            caps.append(state['cap'])
        return state, caps, data, at

    def test_cached_sample_cannot_repeat_an_increase(self):
        state, _, data, at = self.climbing(1440)
        self.assertEqual(state['cap'], 2)
        repeated = policy.decide(data, state, at + 60)
        self.assertEqual(repeated['cap'], 2)
        self.assertEqual(repeated['history'], state['history'])

    def test_low_usage_scales_up_one_step_with_cooldown(self):
        _, caps, _, _ = self.climbing(6000)
        self.assertEqual(caps[:7], [1] * 7)
        self.assertEqual(max(caps), 5)
        self.assertTrue(all(b - a <= 1 for a, b in zip(caps, caps[1:])))
        increases = [i for i in range(1, len(caps)) if caps[i] > caps[i-1]]
        self.assertTrue(all((b-a)*180 >= 1200 for a, b in zip(increases, increases[1:])))

    def test_flat_usage_climbs_only_until_the_cap_exceeds_the_crew(self):
        state = {}
        for offset in range(0, 6000, 180):
            at = NOW + offset
            state = policy.decide(reading(10, stamp=at, reset=NOW + 18000), state, at, agents=2)
        self.assertEqual(state['cap'], 3)

    def test_rising_usage_with_unknown_agents_does_not_creep_the_cap(self):
        _, caps, _, _ = self.climbing(6000, agents=None)
        self.assertEqual(max(caps), 1)

    def test_pause_reopens_at_one_on_next_low_reading(self):
        state = policy.decide(reading(90), {}, NOW)
        self.assertEqual(state['cap'], 0)
        state = policy.decide(reading(10, stamp=NOW + 180, reset=NOW + 18000), state, NOW + 180)
        self.assertEqual(state['cap'], 1)

    def test_repeated_reading_after_stop_stays_labelled_paused(self):
        state = policy.decide(reading(90), {}, NOW)
        repeated = policy.decide(reading(10), state, NOW + 60)
        self.assertEqual((repeated['cap'], repeated['mode']), (0, 'paused'))

    def scaled_up(self):
        state, _, _, at = self.climbing(4500)
        self.assertEqual(state['cap'], 4)
        return state, at

    def test_single_unavailable_reading_at_low_usage_keeps_cap(self):
        state, last_good = self.scaled_up()
        held = policy.decide({'status': 'unavailable'}, state, last_good + 180)
        self.assertEqual(held['cap'], 4)
        self.assertEqual(held['last_good_age_min'], 3)
        later = policy.decide({'status': 'unavailable'}, held, last_good + 360)
        self.assertEqual(later['reason'], held['reason'])

    def test_stop_on_repeated_reading_stays_stopped_through_a_gap(self):
        state, last_good = self.scaled_up()
        with patch.object(policy.pace, 'read_sharing', return_value='off'):
            stopped = policy.decide(reading(10, stamp=last_good, reset=NOW + 18000), state, last_good + 60)
        self.assertEqual(policy.decide({}, stopped, last_good + 180)['cap'], 0)

    def test_twenty_minute_gap_steps_down_but_never_to_zero(self):
        state, last_good = self.scaled_up()
        for offset in range(180, 901, 180):
            state = policy.decide({}, state, last_good + offset)
            self.assertEqual(state['cap'], 4)
        self.assertEqual(policy.decide({}, state, last_good + 1200)['cap'], 2)
        self.assertEqual(policy.decide({}, state, last_good + 6 * 3600)['cap'], 1)

    def test_recovery_after_gap_carries_on_from_current_cap(self):
        state, last_good = self.scaled_up()
        state = policy.decide({}, state, last_good + 1200)
        at = last_good + 1260
        state = policy.decide(reading(10, stamp=at, reset=NOW + 18000), state, at)
        self.assertEqual(state['cap'], 3)
        self.assertIsNotNone(state['projections']['weekly'])

    def test_dropped_readings_keep_cap_and_history(self):
        state, last_good = self.scaled_up()
        history = state['history']
        for offset in (180, 360, 540):
            state = policy.decide(reading(10, stamp=last_good + offset - 400, reset=NOW + 18000), state, last_good + offset)
        self.assertEqual(state['history'], history)
        at = last_good + 720
        state = policy.decide(reading(10, stamp=at, reset=NOW + 18000), state, at)
        self.assertGreaterEqual(state['cap'], 4)
        self.assertEqual(state['history'][:-1], history)

    def rising(self, rate_per_min, minutes, state=None, start_pct=0, start_min=0):
        state = state or {}
        for minute in range(start_min, start_min + minutes + 1, 6):
            at = NOW + minute * 60
            pct = start_pct + rate_per_min * (minute - start_min)
            state = policy.decide(split_reading(pct, at, NOW + 18000), state, at, agents=2)
        return state

    def test_rising_usage_forecasts_the_fitted_window_end(self):
        state = self.rising(0.2, 60)
        self.assertAlmostEqual(state['projections']['session'], 12 + 0.2 * 240, delta=0.5)

    def test_cap_of_ten_drops_to_what_two_measured_agents_support(self):
        state = self.rising(0.2, 60)
        at = NOW + 66 * 60
        result = policy.decide(split_reading(13.2, at, NOW + 18000), dict(state, cap=10), at, agents=2)
        self.assertEqual(result['cap'], 3)

    def test_forecast_below_ninety_preserves_two_running_agents(self):
        state = self.rising(0.28, 54)
        at = NOW + 3600
        result = policy.decide(split_reading(16.8, at, NOW + 18000), dict(state, cap=3), at, agents=2)
        self.assertAlmostEqual(result['projections']['session'], 84, delta=0.5)
        self.assertEqual(result['cap'], 2)

    def test_high_projection_steps_down_without_stopping_low_usage_crew(self):
        state = self.rising(0.4, 60)
        at = NOW + 66 * 60
        result = policy.decide(split_reading(26.4, at, NOW + 18000), dict(state, cap=10), at, agents=2)
        self.assertGreater(result['projections']['session'], 90)
        self.assertEqual(result['cap'], 7)
        for minute in range(69, 91, 3):
            at = NOW + minute * 60
            result = policy.decide(split_reading(0.4 * minute, at, NOW + 18000), result, at, agents=2)
            self.assertGreaterEqual(result['cap'], 2)

    def test_cached_reading_rerun_keeps_the_cap_it_stepped_down_to(self):
        state = self.rising(0.4, 60)
        at = NOW + 66 * 60
        data = split_reading(26.4, at, NOW + 18000)
        stepped = policy.decide(data, dict(state, cap=10), at, agents=2)
        self.assertEqual(stepped['cap'], 7)
        for rerun in range(1, 4):
            stepped = policy.decide(data, stepped, at + rerun * 30, agents=2)
            self.assertEqual(stepped['cap'], 7)

    def test_eighty_six_percent_is_available_until_the_ninety_percent_stop(self):
        data = reading(86, reset=NOW + 18000)
        data['windows'][1]['resetsAt'] = NOW + 7200
        state = {'cap': 4, 'history': [
            {'ts': NOW - minute * 60, 'windows': {w['id']: w for w in data['windows']},
             'cap': 4, 'agents': 4, 'action': 'hold'} for minute in range(60, 0, -6)]}
        state = policy.decide(data, state, NOW, agents=4)
        self.assertEqual(state['cap'], 4)
        data['fetchedAt'] += 180
        data['windows'][0]['usedPct'] = 90
        self.assertEqual(policy.decide(data, state, NOW + 180, agents=4)['cap'], 0)

    def test_second_machine_surge_lowers_cap(self):
        state = self.rising(0.1, 120, start_pct=5)
        self.assertEqual(state['cap'], 6)
        caps, stopped = [], False
        for minute in range(126, 301, 6):
            at = NOW + minute * 60
            state = policy.decide(split_reading(19.4 + 0.5 * (minute - 126), at, NOW + 18000),
                                  state, at, agents=2)
            caps.append(state['cap'])
            if state['cap'] < 2:
                self.assertGreater(state['projections']['session'], 90)
                self.assertGreaterEqual(19.4 + 0.5 * (minute - 126), 75)
                stopped = True
                break
        self.assertLess(min(caps), 6)
        self.assertTrue(stopped)

    def test_old_period_readings_do_not_hide_a_fast_rise_after_reset(self):
        state = {}
        for minute in range(0, 61, 6):
            at = NOW + minute * 60
            state = policy.decide(split_reading(60, at, NOW + 3630), state, at)
        for minute in range(66, 97, 6):
            at = NOW + minute * 60
            state = policy.decide(split_reading(0.5 * (minute - 61), at, NOW + 3630 + 18000), state, at)
        self.assertGreater(state['projections']['session'], 90)
        self.assertEqual(state['cap'], 2)

    def previous_window(self, rate_per_min, end):
        state = {}
        for minute in range(0, 121, 6):
            at = NOW + minute * 60
            state = policy.decide(split_reading(5 + rate_per_min * minute, at, end), state, at, agents=2)
        return state

    def test_new_window_keeps_cap_using_the_previous_window_burn(self):
        end = NOW + 7230
        state = self.previous_window(0.1, end)
        self.assertGreater(state['cap'], 1)
        at = end + 30
        result = policy.decide(split_reading(1, at, at + 18000), state, at)
        self.assertGreaterEqual(result['cap'], state['cap'])
        self.assertAlmostEqual(result['projections']['session'], 31, delta=0.5)

    def test_new_window_read_before_the_old_reset_time_keeps_the_cap(self):
        end = NOW + 7560
        state = self.previous_window(0.1, end)
        self.assertGreater(state['cap'], 1)
        for at in (end - 240, end - 60):
            result = policy.decide(split_reading(0, at, end + 18000), state, at, agents=1)
            self.assertGreaterEqual(result['cap'], state['cap'])
            self.assertAlmostEqual(result['projections']['session'], 30, delta=0.5)
            state = result

    def test_idle_window_renewed_before_the_old_reset_time_keeps_the_cap(self):
        end = NOW + 7560
        state = {}
        for minute in range(0, 121, 6):
            at = NOW + minute * 60
            state = policy.decide(split_reading(0, at, end), state, at, agents=2)
        self.assertGreater(state['cap'], 1)
        at = end - 240
        result = policy.decide(split_reading(0, at, end + 18000), state, at, agents=1)
        self.assertGreaterEqual(result['cap'], state['cap'])
        self.assertEqual(result['projections']['session'], 0)

    def test_new_window_carried_forecast_over_seventy_five_holds(self):
        end = NOW + 7230
        state = self.previous_window(0.27, end)
        at = end + 21 * 60
        result = policy.decide(split_reading(1, at, at + 18000), state, at)
        self.assertAlmostEqual(result['projections']['session'], 82, delta=0.5)
        self.assertEqual((state['cap'], result['cap']), (6, 6))

    def test_new_window_after_a_fast_previous_window_throttles(self):
        end = NOW + 7230
        state = self.previous_window(0.3, end)
        at = end + 30
        result = policy.decide(split_reading(1, at, at + 18000), state, at)
        self.assertEqual(result['cap'], 5)
        self.assertLess(result['cap'], state['cap'])
        self.assertGreaterEqual(result['projections']['session'], 90)

    def after_reset(self, state, at, readings):
        for minute, pct in readings:
            stamp = at + minute * 60
            with patch.object(policy.pace.time, 'time', return_value=stamp):
                state = policy.decide(split_reading(pct, stamp, at + 18000), state, stamp, agents=5)
        return state

    def test_a_burst_in_the_first_minutes_after_reset_keeps_the_cap(self):
        end = NOW + 7230
        state = self.previous_window(0.1, end)
        result = self.after_reset(state, end + 30, [(0, 1), (6, 3)])
        self.assertEqual(result['cap'], state['cap'])

    def test_low_burn_an_hour_after_a_reset_burst_lets_the_cap_climb(self):
        end = NOW + 7230
        state = dict(self.previous_window(0.1, end), cap=1)
        readings = [(0, 1), (6, 3)] + [(m, 3 + (m - 6) / 27) for m in range(9, 61, 3)]
        self.assertGreater(self.after_reset(state, end + 30, readings)['cap'], 1)

    def test_stale_old_window_readings_after_its_reset_do_not_zero_the_carried_burn(self):
        end = NOW + 7230
        state = self.previous_window(0.3, end)
        state = policy.decide(split_reading(41, end + 60, end), state, end + 60)
        at = end + 120
        result = policy.decide(split_reading(1, at, at + 18000), state, at)
        self.assertEqual(result['cap'], 1)
        self.assertGreaterEqual(result['projections']['session'], 90)

    def test_window_past_its_reset_is_not_forecast_from_the_previous_burn(self):
        end = NOW + 7230
        state = self.previous_window(0.1, end)
        result = policy.decide(split_reading(17, end + 60, end), state, end + 60)
        self.assertEqual(result['cap'], 1)
        self.assertIsNone(result['projections']['session'])
        self.assertEqual(result['reason'], 'short-window forecast unknown')

    def test_sharing_off_always_pauses(self):
        with patch.object(policy.pace, 'read_sharing', return_value='off'):
            self.assertEqual(policy.decide(reading(), {}, NOW)['cap'], 0)


class WeekdayPacingTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def week_reading(self, weekly, at, session=10):
        return {'status': 'available', 'fetchedAt': at, 'windows': [
            {'id': 'session', 'usedPct': session, 'resetsAt': max(WEDNESDAY_NOON + 18000, at + 3600)},
            {'id': 'weekly', 'usedPct': weekly, 'resetsAt': MONDAY_RESET}]}

    def step(self, state, weekly, at, session=10, agents=None):
        with patch.object(policy.pace.time, 'time', return_value=at):
            return policy.decide(self.week_reading(weekly, at, session), state, at, agents=agents)

    def scaled_up_by_wednesday_noon(self):
        state = {}
        for offset in range(-4500, 1, 180):
            state = self.step(state, 30, WEDNESDAY_NOON + offset, session=10 + offset / 600, agents=2)
        self.assertEqual(state['cap'], 4)
        return state

    def test_wednesday_noon_at_37_is_ahead_of_a_linear_week_but_not_throttled(self):
        state = self.scaled_up_by_wednesday_noon()
        at = WEDNESDAY_NOON + 180
        result = self.step(state, 37, at)
        self.assertAlmostEqual(result['projections']['weekly'], 74.0, delta=0.2)
        self.assertEqual(result['cap'], 4)

    def test_steady_climb_to_37_is_not_projected_across_the_weekend(self):
        state = self.scaled_up_by_wednesday_noon()
        for minute, pct in enumerate(range(31, 38), start=1):
            state = self.step(state, pct, WEDNESDAY_NOON + minute * 180)
        self.assertGreaterEqual(state['cap'], 3)

    def test_wednesday_noon_at_75_throttles_to_one(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 75, WEDNESDAY_NOON + 180)
        self.assertEqual((result['cap'], result['mode']), (1, 'throttled'))
        self.assertAlmostEqual(result['projections']['weekly'], 150.0, delta=0.4)

    def test_over_the_working_day_line_names_it(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 75, WEDNESDAY_NOON + 180)
        self.assertEqual(result['reason'], 'weekly 75% is over its pace limit 60.0%: capped at 1')

    def test_running_agents_kept_over_the_working_day_line_say_so(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 61, WEDNESDAY_NOON + 180, agents=3)
        self.assertEqual((result['cap'], result['reason']), (
            3, 'keeping 3 working agents; weekly 61% is over its pace limit 60.0%: capped at 1'))

    def test_first_reading_after_a_pause_says_it_resumes(self):
        state = dict(self.scaled_up_by_wednesday_noon(), mode='paused', cap=0)
        result = self.step(state, 30, WEDNESDAY_NOON + 180, agents=0)
        self.assertEqual((result['cap'], result['reason']), (1, 'resuming from a pause'))

    def test_usage_a_hair_over_the_working_day_line_throttles(self):
        state = {}
        for offset in range(-6000, -300, 180):
            state = self.step(state, 30, WEDNESDAY_NOON + offset, session=10 + offset / 600, agents=2)
        self.assertEqual(self.step(state, 60, WEDNESDAY_NOON - 144)['cap'], 1)

    def test_working_week_forecast_under_ninety_raises_the_cap(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 39, WEDNESDAY_NOON + 1500, agents=4)
        self.assertAlmostEqual(result['projections']['weekly'], 77.5, delta=0.1)
        self.assertEqual(result['cap'], 5)

    def test_working_week_forecast_at_ninety_holds_the_cap(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 45.4, WEDNESDAY_NOON + 1500, agents=4)
        self.assertAlmostEqual(result['projections']['weekly'], 90.2, delta=0.1)
        self.assertEqual(result['cap'], 4)

    def test_weekly_hold_reason_shows_the_ninety_percent_raise_limit(self):
        state = self.scaled_up_by_wednesday_noon()
        result = self.step(state, 45.4, WEDNESDAY_NOON + 1500, agents=4)
        self.assertEqual(result['reason'],
                         'weekly forecast 90.2% vs raise limit 90%: holding: not comfortably clear of both ceilings')

    def test_whole_week_paces_evenly_to_the_reset(self):
        state = self.scaled_up_by_wednesday_noon()
        with patch.dict(policy.CONFIG, weekly_pace='whole_week'):
            held = self.step(state, 39, WEDNESDAY_NOON + 1500, agents=0)
            throttled = self.step(state, 48, WEDNESDAY_NOON + 1500, agents=0)
        self.assertAlmostEqual(held['projections']['weekly'], 108.4, delta=0.1)
        self.assertEqual((held['cap'], throttled['cap']), (4, 1))

    def test_whole_week_weekend_keeps_pacing_toward_the_reset(self):
        saturday_noon = WINDOW_START + 5.5 * DAY
        with patch.dict(policy.CONFIG, weekly_pace='whole_week'):
            projection = self.step({}, 40, saturday_noon)['projections']['weekly']
        self.assertAlmostEqual(projection, 50.9, delta=0.1)

    def test_margin_edge_wednesday_noon(self):
        state = self.scaled_up_by_wednesday_noon()
        self.assertEqual(self.step(state, 59, WEDNESDAY_NOON + 180)['cap'], 4)
        self.assertEqual(self.step(state, 61, WEDNESDAY_NOON + 180)['cap'], 1)

    def test_just_over_the_line_but_inside_the_margin_holds_over_several_ticks(self):
        state = self.scaled_up_by_wednesday_noon()
        for tick in range(1, 5):
            state = self.step(state, 47, WEDNESDAY_NOON + tick * 180)
            self.assertEqual(state['cap'], 4)

    def test_light_usage_just_after_the_reset_does_not_throttle(self):
        state = {}
        for tick in range(0, 6000, 180):
            state = self.step(state, 0, WINDOW_START + 3600 + tick, session=tick / 6000, agents=2)
        self.assertEqual(state['cap'], 4)
        state = self.step(state, 2, WINDOW_START + 3600 + 6000, session=1)
        self.assertEqual(state['cap'], 4)

    def model_week_reading(self, weekly, fable, at, session):
        data = self.week_reading(weekly, at, session)
        data['windows'].append({'id': 'weekly_model_fable', 'usedPct': fable, 'resetsAt': MONDAY_RESET})
        return data

    def model_step(self, state, weekly, fable, at, session=10, agents=None):
        with patch.object(policy.pace.time, 'time', return_value=at):
            return policy.decide(self.model_week_reading(weekly, fable, at, session), state, at, agents=agents)

    def test_per_model_weekly_window_is_paced_over_working_days(self):
        at = WEDNESDAY_NOON + 3600
        state = {}
        for offset in range(-4500, 1, 180):
            state = self.model_step(state, 30, 20, at + offset, session=10 + offset / 600, agents=2)
        self.assertEqual(state['cap'], 4)
        state = self.model_step(state, 41, 28, at + 180)
        self.assertEqual(state['cap'], 4)
        self.assertAlmostEqual(state['projections']['weekly_model_fable'], 55.0, delta=0.2)

    def test_per_model_weekly_window_past_the_margin_throttles(self):
        at = WEDNESDAY_NOON + 3600
        state = {}
        for offset in range(-6000, 1, 180):
            state = self.model_step(state, 30, 20, at + offset, session=10 + offset / 600, agents=2)
        self.assertEqual(self.model_step(state, 41, 61, at + 180)['cap'], 1)

    def test_weekend_hours_add_no_budget(self):
        saturday_noon = WINDOW_START + 5.5 * DAY
        friday_end = WINDOW_START + 5 * DAY
        before = self.step({}, 40, friday_end - 1)['projections']['weekly']
        during = self.step({}, 40, saturday_noon)['projections']['weekly']
        self.assertEqual(during, 40.0)
        self.assertAlmostEqual(before, 40.0, delta=0.01)

    def test_emergency_ceiling_still_stops_on_a_light_weekday_share(self):
        result = self.step({}, 90, WEDNESDAY_NOON)
        self.assertEqual(result['cap'], 0)

    def test_working_fraction_counts_only_weekdays(self):
        start = WINDOW_START
        self.assertEqual(policy.working_fraction(start, MONDAY_RESET, WEDNESDAY_NOON), 0.5)
        self.assertEqual(policy.working_fraction(start, MONDAY_RESET, start + 6 * DAY), 1.0)
        self.assertEqual(policy.working_fraction(start, MONDAY_RESET, start), 0.0)


SATURDAY_FIVE_HOUR_RESET = 1792843800
SATURDAY_WEEKLY_RESET = 1792969200
SATURDAY_READINGS = [  # gate.json, 2026-10-24 09:37-11:33 BST: (ts, five_hour %, weekly %, agents)
    (1792831043, 3, 36, 0), (1792832354, 3, 36, 0), (1792832714, 3, 36, 0), (1792833074, 3, 36, 0),
    (1792833434, 3, 36, 0), (1792833794, 3, 36, 0), (1792834154, 3, 36, 0), (1792834514, 3, 36, 0),
    (1792834874, 3, 36, 0), (1792835235, 3, 36, 0), (1792835594, 3, 36, 0), (1792836979, 3, 36, 0),
    (1792837338, 3, 36, 0), (1792837651, 5, 37, 0), (1792837981, 5, 37, 1)]


class LowUsageTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def test_five_pct_with_a_day_and_a_half_of_weekly_left_raises_a_cap_of_one(self):
        state = {'cap': 1, 'mode': 'throttled'}
        for at, five_hour, weekly, agents in SATURDAY_READINGS:
            data = {'status': 'available', 'fetchedAt': at, 'windows': [
                {'id': 'five_hour', 'usedPct': five_hour, 'resetsAt': SATURDAY_FIVE_HOUR_RESET},
                {'id': 'weekly', 'usedPct': weekly, 'resetsAt': SATURDAY_WEEKLY_RESET},
                {'id': 'weekly_model_fable', 'usedPct': 15, 'resetsAt': SATURDAY_WEEKLY_RESET}]}
            state = policy.decide(data, state, at + 5, agents=agents)
        self.assertEqual(state['cap'], 2)


OCTOBER_28_FIVE_HOUR_RESET = 1793230200
OCTOBER_28_NEXT_FIVE_HOUR_RESET = 1793248200
OCTOBER_28_WEEKLY_RESET = 1793574000
OCTOBER_28_READINGS = [  # gate.json, 2026-10-28 23:08-23:32 UTC: (ts, five_hour %, five_hour reset)
    (1793228933, 27, OCTOBER_28_FIVE_HOUR_RESET), (1793229293, 27, OCTOBER_28_FIVE_HOUR_RESET),
    (1793229653, 27, OCTOBER_28_FIVE_HOUR_RESET), (1793230013, 27, OCTOBER_28_FIVE_HOUR_RESET),
    (1793230373, 0, OCTOBER_28_NEXT_FIVE_HOUR_RESET)]


class FreshHistoryTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def test_twenty_minutes_of_readings_raise_without_the_full_observation(self):
        state = {}
        for at, five_hour, reset in OCTOBER_28_READINGS:
            data = {'status': 'available', 'fetchedAt': at, 'windows': [
                {'id': 'five_hour', 'usedPct': five_hour, 'resetsAt': reset},
                {'id': 'weekly', 'usedPct': 48, 'resetsAt': OCTOBER_28_WEEKLY_RESET},
                {'id': 'weekly_model_fable', 'usedPct': 19, 'resetsAt': OCTOBER_28_WEEKLY_RESET}]}
            with patch.object(policy.pace.time, 'time', return_value=at + 5):
                state = policy.decide(data, state, at + 5, agents=1)
        self.assertEqual(state['cap'], 2)
        self.assertNotIn('observing', state['reason'])


class PacingOverridesTest(unittest.TestCase):
    def test_an_override_replaces_only_its_own_pacing_value(self):
        config = policy.with_overrides({'weekly_target_pct': 70, 'weekly_pace': 'whole_week', 'max_concurrency': 3})
        self.assertEqual((config['weekly_target_pct'], config['weekly_pace'], config['max_concurrency']),
                         (70, 'whole_week', 3))
        self.assertEqual(config['up_margin_pct'], policy.CONFIG['up_margin_pct'])
        self.assertEqual(policy.CONFIG['weekly_target_pct'], 90)

    def test_out_of_range_or_unknown_overrides_are_rejected(self):
        for bad in ({'stop_pct': -1}, {'contingency_5h_pct': 100.5}, {'max_concurrency': 0},
                    {'max_concurrency': 2.5}, {'weekly_pace': 'fortnight'}, {'start_effort': 'high'},
                    {'up_margin_pct': True}, []):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                policy.with_overrides(bad)

    def test_the_hard_stop_comes_from_the_given_config(self):
        result = policy.decide(reading(85), {}, NOW, config=policy.with_overrides({'stop_pct': 80}))
        self.assertEqual((result['cap'], result['reason']), (0, 'actual usage >=80%'))


if __name__ == '__main__':
    unittest.main()
