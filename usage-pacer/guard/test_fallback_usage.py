import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from test_policy import NOW, policy, reading
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


class FallbackUsageGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        cli = self.home / 'paseo'
        cli.write_text('#!/bin/sh\nexit 0\n')
        cli.chmod(0o755)
        node = self.home / 'node'
        node.write_text('#!/bin/sh\nexec cat "$USAGE_PACER_STATE/usage.json"\n')
        node.chmod(0o755)
        (self.home / 'config.json').write_text(json.dumps({'cli': str(cli), 'node': str(node)}))
        self.env = dict(os.environ, HOME=str(self.home), USAGE_PACER_STATE=str(self.home),
                        USAGE_PACER_NOTICE_STATE=str(self.home / 'notices'))
        self.env.pop('PASEO_AGENT_ID', None)

    def paseo_reports(self, status, weekly_pct=95):
        providers = [] if status is None else [{
            'providerId': 'claude', 'status': status,
            'windows': [{'id': 'weekly', 'usedPct': weekly_pct,
                         'resetsAt': datetime_iso(time.time() + WEEKLY_RESET_IN)}]}]
        (self.home / 'usage.json').write_text(json.dumps(
            {'fetchedAt': datetime_iso(time.time()), 'providers': providers, 'bases': {}, 'agents': []}))

    def fallback_reading(self, age_minutes, weekly_pct=40):
        fetched = time.time() - age_minutes * 60
        (self.home / 'fallback-usage.json').write_text(json.dumps({'claude': {
            'fetchedAt': datetime_iso(fetched),
            'windows': [{'id': 'weekly', 'usedPct': weekly_pct,
                         'resetsAt': datetime_iso(time.time() + WEEKLY_RESET_IN)}]}}))

    def check_claude(self):
        return subprocess.run([sys.executable, str(HERE / 'guard.py'), '--check', 'claude'],
                              env=self.env, capture_output=True, text=True, timeout=30)

    def assert_allowed(self, result):
        self.assertEqual((result.returncode, json.loads(result.stdout)['allowed']), (0, True), result.stderr)

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

    def test_a_sixteen_minute_old_reading_is_too_stale(self):
        self.paseo_reports('unavailable')
        self.fallback_reading(age_minutes=16)
        self.assertEqual(self.check_claude().returncode, 2)

    def test_an_available_paseo_reading_wins_over_the_file(self):
        self.paseo_reports('available', weekly_pct=95)
        self.fallback_reading(age_minutes=1, weekly_pct=10)
        self.assertEqual(self.check_claude().returncode, 2)
        self.assertEqual(json.loads((self.home / 'gate.json').read_text())['providers']['claude']['reason'],
                         'actual usage >=90%')

    def test_a_stale_paseo_reading_keeps_the_five_minute_limit(self):
        self.paseo_reports('available', weekly_pct=40)
        usage = json.loads((self.home / 'usage.json').read_text())
        usage['fetchedAt'] = datetime_iso(time.time() - 600)
        (self.home / 'usage.json').write_text(json.dumps(usage))
        self.assertEqual(self.check_claude().returncode, 2)

    def test_without_the_file_an_unavailable_provider_stays_closed(self):
        self.paseo_reports('unavailable')
        self.assertEqual(self.check_claude().returncode, 2)

    def test_a_malformed_file_closes_an_unavailable_provider_and_says_why(self):
        self.paseo_reports('unavailable')
        (self.home / 'fallback-usage.json').write_text('{not json')
        self.assertEqual(self.check_claude().returncode, 2)
        reason = json.loads((self.home / 'gate.json').read_text())['providers']['claude']['reason']
        self.assertIn('fallback-usage.json', reason)

    def test_a_malformed_file_never_breaks_an_available_paseo_reading(self):
        self.paseo_reports('available', weekly_pct=40)
        (self.home / 'fallback-usage.json').write_text('{not json')
        self.assert_allowed(self.check_claude())


if __name__ == '__main__':
    unittest.main()
