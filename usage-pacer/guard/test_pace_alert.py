import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from test_support import FIRSTMATE_CONFIG

from pace_alert import pace_alerts, weekly_burn_per_hour

HERE = Path(__file__).parent
HOUR = 3600


def iso(stamp):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat()


def reading(ts, pct, reset):
    return {'ts': ts, 'windows': {'weekly': {'id': 'weekly', 'usedPct': pct, 'resetsAt': reset}}}


class WeeklyBurnTests(unittest.TestCase):
    def test_burn_is_the_rise_per_hour_over_the_last_three_hours_of_this_period(self):
        reset = 1_000_000
        history = [reading(reset - 70 * HOUR, 10, reset - 1), reading(reset - 65 * HOUR, 23, reset),
                   reading(reset - 63 * HOUR, 39, reset), reading(reset - 61 * HOUR, 47, reset)]
        self.assertEqual(weekly_burn_per_hour(history, 'weekly', reset, now=reset - 61 * HOUR), 4.0)

    def test_burn_is_unknown_under_twenty_minutes_of_readings(self):
        reset = 1_000_000
        history = [reading(reset - 600, 40, reset), reading(reset - 60, 41, reset)]
        self.assertIsNone(weekly_burn_per_hour(history, 'weekly', reset, now=reset - 60))


class PaceAlertTests(unittest.TestCase):
    reset = 2_000_000
    now = reset - 61 * HOUR

    def alerts(self, forecast, used, seen):
        history = [reading(self.now - 2 * HOUR, used - 16, self.reset), reading(self.now, used, self.reset)]
        gate = {'claude': {'projections': {'weekly': forecast}, 'history': history}}
        return pace_alerts(gate, seen, self.now)

    def test_a_weekly_forecast_crossing_85_prints_forecast_used_burn_and_hours_to_reset(self):
        lines, seen = self.alerts(97.8, 50, {})
        self.assertEqual(lines, ['claude weekly: forecast 97.8% at reset (past 95%), used 50%, '
                                 'burning 8.0%/h, 61.0 h to reset'])
        self.assertEqual(seen, {'claude/weekly': {'step': 95, 'resetsAt': self.reset}})

    def test_the_same_step_does_not_print_again_but_a_further_step_does(self):
        _, seen = self.alerts(86, 40, {})
        self.assertEqual(self.alerts(88, 42, seen)[0], [])
        lines, seen = self.alerts(91, 44, seen)
        self.assertIn('past 90%', lines[0])

    def test_a_forecast_under_85_prints_nothing(self):
        self.assertEqual(self.alerts(84.9, 40, {}), ([], {}))

    def test_a_new_weekly_period_alerts_again(self):
        _, seen = self.alerts(96, 50, {})
        seen['claude/weekly']['resetsAt'] = self.reset - 7 * 24 * HOUR
        self.assertEqual(len(self.alerts(86, 40, seen)[0]), 1)



class GuardHome:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.data = self.home
        node = self.home / 'node'
        node.write_text('#!/bin/sh\nexec cat "$USAGE_PACER_STATE/usage.json"\n')
        node.chmod(0o755)
        cli = self.home / 'paseo'
        cli.write_text('#!/bin/sh\nexit 0\n')
        cli.chmod(0o755)
        (self.data / 'config.json').write_text(json.dumps(
            {'cli': str(cli), 'node': str(node), 'managed_roots': [], **FIRSTMATE_CONFIG}))
        (self.data / 'pacing-overrides.json').write_text(json.dumps({'weekly_pace': 'whole_week'}))
        self.env = dict(os.environ, HOME=str(self.home), USAGE_PACER_STATE=str(self.home),
                        USAGE_PACER_NOTICE_STATE=str(self.home / 'notices'))
        self.env.pop('PASEO_AGENT_ID', None)

    def write_usage(self, weekly_pct, agents):
        now = time.time()
        reset = now + 3 * 24 * HOUR
        (self.home / 'usage.json').write_text(json.dumps({
            'fetchedAt': iso(now), 'bases': {}, 'agents': agents,
            'providers': [{'providerId': 'claude', 'status': 'available',
                           'windows': [{'id': 'weekly', 'usedPct': weekly_pct, 'resetsAt': iso(reset)}]}]}))

    def guard(self, *args):
        return subprocess.run([sys.executable, str(HERE / 'guard.py'), *args], env=self.env,
                              capture_output=True, text=True, timeout=20)


class WatchFindingTests(GuardHome, unittest.TestCase):
    def test_with_firstmate_labels_crew_the_first_mate_started_counts(self):
        self.write_usage(10, [
            {'id': 'fm', 'provider': 'claude', 'status': 'idle', 'labels': {'firstmate.role': 'first-mate'},
             'pendingPermissionCount': 0},
            {'id': 'fm-child', 'provider': 'claude', 'status': 'running', 'labels': {}, 'parentAgentId': 'fm',
             'createdAt': iso(time.time()), 'pendingPermissionCount': 0}])
        check = json.loads(self.guard('--check', 'claude', '--slots', '0').stdout)
        self.assertEqual(check['active'], 1)

    def test_the_first_mate_itself_is_never_managed(self):
        self.write_usage(10, [
            {'id': 'fm', 'provider': 'claude', 'status': 'running', 'labels': {'firstmate.role': 'first-mate'},
             'pendingPermissionCount': 0}])
        self.assertEqual(json.loads(self.guard('--check', 'claude', '--slots', '0').stdout)['active'], 0)

    def test_rising_weekly_with_a_flat_cap_prints_one_pace_alert_per_step(self):
        self.write_usage(20, [])
        self.assertEqual(self.guard().stdout, '')
        self.write_usage(50, [])
        alert = self.guard().stdout
        self.assertIn('Subscription pace alert', alert)
        self.assertIn('claude weekly: forecast 87.5% at reset (past 85%), used 50%', alert)
        self.write_usage(51, [])
        self.assertEqual(self.guard().stdout, '')
        self.write_usage(52, [])
        self.assertIn('past 90%', self.guard().stdout)

    def test_a_repeated_snapshot_failure_reports_once_and_still_fails(self):
        (self.home / 'usage.json').write_text('not json')
        first = self.guard()
        second = self.guard()
        self.assertEqual((first.returncode, second.returncode), (1, 1))
        self.assertIn('Paseo snapshot unavailable', first.stderr)
        self.assertEqual(second.stderr, '')


class SnapshotDeadlineTests(unittest.TestCase):
    def test_a_slow_failed_read_is_not_retried_past_the_watch_deadline(self):
        import guard
        clock = iter([0, guard.RETRY_DEADLINE_SECONDS + 1])
        with patch.object(guard.time, 'monotonic', side_effect=lambda: next(clock)), \
             patch.object(guard.time, 'sleep') as pause, \
             patch.object(guard, 'snapshot', side_effect=subprocess.TimeoutExpired('node', 40)) as read:
            with self.assertRaises(subprocess.TimeoutExpired):
                guard.snapshot_with_retry({})
        pause.assert_not_called()
        self.assertEqual(read.call_count, 1)


if __name__ == '__main__':
    unittest.main()
