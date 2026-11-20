import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from test_policy import NOW, policy, reading
from test_support import FIRSTMATE_CONFIG, install_stub_paseo
from test_watch import datetime_iso

HERE = Path(__file__).parent
WEEKLY_RESET_IN = 3 * 86400


class FallbackUsagePolicyTests(unittest.TestCase):
    def test_a_longer_max_age_accepts_a_reading_the_default_rejects(self):
        ten_minutes_old = reading(stamp=NOW - 600)
        self.assertEqual(policy.reading_problem(ten_minutes_old, NOW, []), 'invalid or stale usage')
        self.assertIsNone(policy.reading_problem(ten_minutes_old, NOW, [], max_age=900))
        self.assertEqual(policy.reading_problem(reading(stamp=NOW - 901), NOW, [], max_age=900),
                         'invalid or stale usage')

    def test_a_source_problem_is_reported_in_place_of_a_valid_reading(self):
        self.assertEqual(policy.reading_problem(reading(), NOW, [], source_problem='file is bad'), 'file is bad')


class FallbackUsageGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        install_stub_paseo(self.home, **FIRSTMATE_CONFIG)
        self.env = dict(os.environ, HOME=str(self.home), USAGE_PACER_STATE=str(self.home),
                        USAGE_PACER_NOTICE_STATE=str(self.home / 'notices'))
        self.env.pop('PASEO_AGENT_ID', None)

    def window(self, pct, window_id='weekly'):
        return {'id': window_id, 'usedPct': pct, 'resetsAt': datetime_iso(time.time() + WEEKLY_RESET_IN)}

    def paseo_reports(self, status, windows=None, agents=()):
        providers = [] if status is None else [{
            'providerId': 'claude', 'status': status, 'windows': windows or [self.window(95)]}]
        (self.home / 'usage.json').write_text(json.dumps(
            {'fetchedAt': datetime_iso(time.time()), 'providers': providers, 'bases': {}, 'agents': list(agents)}))

    def fallback_reading(self, age_minutes, windows=None):
        (self.home / 'fallback-usage.json').write_text(json.dumps({'claude': {
            'fetchedAt': datetime_iso(time.time() - age_minutes * 60), 'windows': windows or [self.window(40)]}}))

    def fallback_entry(self, entry):
        (self.home / 'fallback-usage.json').write_text(json.dumps({'claude': entry}))

    def check_claude(self):
        return subprocess.run([sys.executable, str(HERE / 'guard.py'), '--check', 'claude'],
                              env=self.env, capture_output=True, text=True, timeout=30)

    def gate(self):
        return json.loads((self.home / 'gate.json').read_text())

    def claude_gate(self):
        return self.gate()['providers']['claude']

    def assert_allowed(self, result):
        self.assertEqual((result.returncode, json.loads(result.stdout)['allowed']), (0, True), result.stderr)

    def seed_history_from_paseo(self, windows=None):
        self.paseo_reports('available', windows or [self.window(40)])
        self.check_claude()
        return self.claude_gate()

    def test_a_ten_minute_old_reading_stands_in_for_an_unavailable_provider(self):
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=10)
        self.assert_allowed(self.check_claude())

    def test_a_ten_minute_old_reading_stands_in_for_an_absent_provider(self):
        self.paseo_reports(None)
        self.fallback_reading(age_minutes=10)
        self.assert_allowed(self.check_claude())

    def test_a_ten_minute_old_reading_stands_in_for_a_provider_in_error(self):
        self.paseo_reports('error')
        self.fallback_reading(age_minutes=10)
        self.assert_allowed(self.check_claude())

    def test_a_sixteen_minute_old_reading_with_no_history_keeps_the_gate_closed(self):
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=16)
        self.assertEqual(self.check_claude().returncode, 2)

    def test_a_future_dated_reading_is_rejected(self):
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=-10)
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertEqual(self.claude_gate()['reason'], 'invalid or stale usage')

    def test_a_stale_reading_after_a_good_one_holds_the_last_good_decision(self):
        seeded = self.seed_history_from_paseo([self.window(10)])
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=16, windows=[self.window(10)])
        self.check_claude()
        held = self.claude_gate()
        self.assertEqual(held['reason'], 'invalid or stale usage; holding last good reading')
        self.assertEqual((held['cap'], held['fetched_at']), (seeded['cap'], seeded['fetched_at']))

    def test_an_available_paseo_reading_wins_over_the_file(self):
        self.paseo_reports('available', [self.window(95)])
        self.fallback_reading(age_minutes=1, windows=[self.window(10)])
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertEqual(self.claude_gate()['reason'], 'actual usage >=90%')

    def test_a_stale_paseo_reading_keeps_the_five_minute_limit(self):
        self.paseo_reports('available', [self.window(40)])
        usage = json.loads((self.home / 'usage.json').read_text())
        usage['fetchedAt'] = datetime_iso(time.time() - 600)
        (self.home / 'usage.json').write_text(json.dumps(usage))
        self.assertEqual(self.check_claude().returncode, 2)

    def test_without_the_file_an_unavailable_provider_stays_closed(self):
        self.paseo_reports('unavailable')
        self.assertEqual(self.check_claude().returncode, 2)

    def test_a_fallback_at_the_stop_limit_closes_the_gate_and_stops_a_working_agent(self):
        crew = {'id': 'crew', 'provider': 'claude', 'status': 'running', 'labels': {'firstmate.role': 'crew'},
                'createdAt': '2026-10-28T10:00:00+00:00', 'pendingPermissionCount': 0}
        self.paseo_reports('unavailable', agents=[crew])
        self.fallback_reading(age_minutes=1, windows=[self.window(95)])
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertEqual(self.claude_gate()['reason'], 'actual usage >=90%')
        self.assertEqual((self.home / 'stops').read_text().split(), ['crew'])

    def test_a_fallback_without_the_window_that_closed_the_gate_does_not_reopen_it(self):
        self.seed_history_from_paseo([self.window(40), self.window(95, 'weekly_model_fable')])
        self.assertEqual(self.check_claude().returncode, 2)
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=0, windows=[self.window(40)])
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertEqual(self.claude_gate()['reason'], 'actual usage >=90%')

    def test_a_malformed_file_with_no_history_closes_the_gate_and_says_why(self):
        self.paseo_reports('unavailable')
        (self.home / 'fallback-usage.json').write_text('{not json')
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertIn('fallback-usage.json is not valid JSON', self.claude_gate()['reason'])

    def test_a_malformed_file_after_a_good_reading_holds_and_says_why(self):
        seeded = self.seed_history_from_paseo([self.window(10)])
        self.paseo_reports('unavailable')
        (self.home / 'fallback-usage.json').write_text('{not json')
        self.check_claude()
        held = self.claude_gate()
        self.assertRegex(held['reason'], r'^fallback-usage\.json is not valid JSON: .*; holding last good reading$')
        self.assertEqual(held['fetched_at'], seeded['fetched_at'])

    def test_a_malformed_file_never_breaks_an_available_paseo_reading(self):
        self.paseo_reports('available', [self.window(40)])
        (self.home / 'fallback-usage.json').write_text('{not json')
        self.assert_allowed(self.check_claude())

    def test_a_file_that_cannot_be_read_closes_the_provider_and_says_why(self):
        self.paseo_reports('unavailable')
        (self.home / 'fallback-usage.json').mkdir()
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertIn('fallback-usage.json cannot be read', self.claude_gate()['reason'])

    def test_a_malformed_entry_closes_only_its_provider(self):
        bad_entries = {'a string for windows': {'windows': 'abc'}, 'null windows': {'windows': None},
                       'a list of strings': {'windows': ['x']}, 'an object for windows': {'windows': {'a': 1}},
                       'a number for windows': {'windows': 5}, 'a window with a list id': {'windows': [{'id': ['x']}]},
                       'an entry that is a string': 'abc'}
        for name, entry in bad_entries.items():
            with self.subTest(name):
                self.paseo_reports('unavailable')
                self.fallback_entry(dict(entry, fetchedAt=datetime_iso(time.time())) if isinstance(entry, dict) else entry)
                self.assertEqual(self.check_claude().returncode, 2)
                providers = self.gate()['providers']
                self.assertEqual(sorted(providers), ['claude', 'codex'])
                self.assertIn('fallback-usage.json', providers['claude']['reason'])


if __name__ == '__main__':
    unittest.main()
