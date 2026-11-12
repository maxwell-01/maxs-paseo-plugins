import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_pace_alert import GuardHome, iso
from usage_log import append_reading, hourly_report, read_logs

HERE = Path(__file__).parent
HOUR = 3600
RESET = 100 * HOUR


def line(ts, pct, active, host='tower', reset=RESET):
    return {'ts': ts, 'host': host, 'active': active, 'windows': {'claude/weekly': [pct, reset]}}


class UsageLogTests(unittest.TestCase):
    def test_a_reading_appends_one_line_with_every_window_and_the_active_count(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'usage-log.jsonl'
            live = {'providers': [{'providerId': 'claude', 'windows': [
                {'id': 'weekly', 'usedPct': 50, 'resetsAt': '2026-11-08T23:00:00+00:00'},
                {'id': 'weekly_model_fable', 'usedPct': 20, 'resetsAt': '2026-11-08T23:00:00+00:00'},
                {'id': 'five_hour', 'usedPct': 3, 'resetsAt': '2026-11-04T15:00:00+00:00'}]}]}
            for active in (2, 0):
                append_reading(path, 'mac', live, active, now=1000.0)
            rows = [json.loads(text) for text in path.read_text().splitlines()]
        self.assertEqual([row['active'] for row in rows], [2, 0])
        self.assertEqual(rows[0]['host'], 'mac')
        self.assertEqual(rows[0]['windows']['claude/weekly'], [50, 1794178800.0])
        self.assertEqual(set(rows[0]['windows']), {'claude/weekly', 'claude/weekly_model_fable', 'claude/five_hour'})

    def test_idle_and_busy_hours_get_their_own_rate(self):
        rows = [line(10 * HOUR, 20, 0), line(10.5 * HOUR, 21, 0), line(11 * HOUR + 60, 22, 0),
                line(11.5 * HOUR, 30, 3), line(12 * HOUR - 60, 36, 0, host='mac')]
        report = hourly_report(rows, start=10 * HOUR, end=12 * HOUR)
        self.assertEqual(report['claude/weekly'], {'idle': {'hours': 1, 'pct_per_hour': 1.0},
                                                   'busy': {'hours': 1, 'pct_per_hour': 14.0}})

    def test_a_reset_and_a_lagging_host_add_no_usage(self):
        rows = [line(10 * HOUR, 40, 0), line(10.2 * HOUR, 42, 0, host='mac'), line(10.4 * HOUR, 41, 0),
                line(10.6 * HOUR, 1, 0, reset=RESET + 168 * HOUR), line(10.8 * HOUR, 2, 0, reset=RESET + 168 * HOUR)]
        self.assertEqual(hourly_report(rows, start=10 * HOUR, end=11 * HOUR)['claude/weekly']['idle'],
                         {'hours': 1, 'pct_per_hour': 3.0})

    def test_a_gap_over_thirty_minutes_adds_no_usage(self):
        rows = [line(10 * HOUR, 40, 0), line(10.9 * HOUR, 48, 0)]
        self.assertEqual(hourly_report(rows, start=10 * HOUR, end=11 * HOUR)['claude/weekly']['idle'],
                         {'hours': 0, 'pct_per_hour': None})

    def test_logs_from_several_machines_are_read_together_and_the_report_prints(self):
        with tempfile.TemporaryDirectory() as temp:
            tower, mac = Path(temp) / 'tower.jsonl', Path(temp) / 'mac.jsonl'
            tower.write_text(json.dumps(line(10 * HOUR, 20, 0)) + '\n')
            mac.write_text(json.dumps(line(10.25 * HOUR, 22, 0, host='mac')) + '\n')
            self.assertEqual(len(read_logs([tower, mac])), 2)
            printed = subprocess.run([sys.executable, str(HERE / 'usage_log.py'), '--log', str(tower), '--log',
                                      str(mac), '--hours', '1e6'], capture_output=True, text=True, timeout=10)
        self.assertEqual(printed.returncode, 0, printed.stderr)
        self.assertIn('claude/weekly: idle 1 h at 2.0%/h; busy 0 h', printed.stdout)


class GuardRunLogTests(GuardHome, unittest.TestCase):
    def test_every_guard_run_logs_the_reading_and_this_machine_s_active_crew(self):
        self.write_usage(30, [{'id': 'crew', 'provider': 'claude', 'status': 'running',
                               'labels': {'firstmate.role': 'crew'}, 'createdAt': iso(0), 'pendingPermissionCount': 0}])
        self.guard()
        self.guard('--check', 'claude')
        rows = read_logs([self.data / 'usage-log.jsonl'])
        self.assertEqual([(row['active'], row['windows']['claude/weekly'][0]) for row in rows], [(1, 30), (1, 30)])

    def test_a_failed_read_logs_nothing(self):
        (self.home / 'usage.json').write_text('not json')
        self.guard()
        self.assertFalse((self.data / 'usage-log.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
