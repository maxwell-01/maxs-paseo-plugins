import json
import os
from pathlib import Path
from unittest.mock import patch
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).parent


class WatchBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.data = self.home / 'data/subscription-usage-watch'
        (self.data / 'assets').mkdir(parents=True)
        (self.data / 'assets/guard.py').symlink_to(HERE / 'guard.py')
        self.fixture = self.home / 'usage.json'
        self.cli = self.home / 'paseo'
        self.cli.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
home = pathlib.Path(os.environ['FIRSTMATE_HOME'])
with (home / 'calls').open('a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1] == 'agent':
    if os.environ.get('LABEL_FAIL'):
        sys.exit(1)
    path = home / 'usage.json'
    data = json.loads(path.read_text())
    key, value = sys.argv[5].split('=', 1)
    for agent in data['agents']:
        if agent['id'] == sys.argv[3]:
            agent['labels'][key] = value
    path.write_text(json.dumps(data))
if sys.argv[1] != 'stop':
    sys.exit(0)
with (home / 'stops').open('a') as log:
    log.write(sys.argv[2] + '\\n')
if sys.argv[2] == os.environ.get('STOP_FAIL_ID'):
    sys.exit(1)
if not os.environ.get('STOP_NOOP') or os.environ.get('STOP_RACE'):
    path = home / 'usage.json'
    data = json.loads(path.read_text())
    for agent in data['agents']:
        if agent['id'] == sys.argv[2]:
            agent['status'] = 'idle'
    path.write_text(json.dumps(data))
ids = [] if os.environ.get('STOP_NOOP') or os.environ.get('STOP_RACE') else [sys.argv[2]]
print(json.dumps({'agentIds': ids, 'stoppedCount': len(ids)}))
""")
        self.cli.chmod(0o755)
        node = self.home / 'node'
        node.write_text("#!/bin/sh\nexec cat \"$FIRSTMATE_HOME/usage.json\"\n")
        node.chmod(0o755)
        (self.data / 'config.json').write_text(json.dumps({'cli': str(self.cli), 'node': str(node),
                                                           'paseo_home': str(self.home)}))
        self.env = dict(os.environ, FIRSTMATE_HOME=str(self.home), FIRSTMATE_WATCH_STATE=str(self.home / 'watch-state'))
        self.env.pop('PASEO_AGENT_ID', None)
        self.set_usage(90)

    def set_usage(self, pct):
        at = time.time()
        kept = ({a['id']: a['labels'] for a in json.loads(self.fixture.read_text())['agents']}
                if self.fixture.exists() else {})
        self.fixture.write_text(json.dumps({
            'fetchedAt': datetime_iso(at), 'providers': [{'providerId': 'claude', 'status': 'available',
                'windows': [{'id': 'session', 'usedPct': pct, 'resetsAt': datetime_iso(at + 3600)}]}],
            'bases': {}, 'agents': [
                {'id': 'crew', 'provider': 'claude', 'status': 'running', 'labels': {'firstmate.role': 'crew'},
                 'createdAt': '2026-10-28T10:00:00+00:00', 'pendingPermissionCount': 0},
                {'id': 'child', 'provider': 'claude', 'status': 'running', 'labels': {}, 'parentAgentId': 'crew',
                 'createdAt': '2026-10-28T10:30:00+00:00', 'pendingPermissionCount': 0},
                {'id': 'human', 'provider': 'claude', 'status': 'running', 'labels': {}, 'pendingPermissionCount': 0},
                {'id': 'idle', 'provider': 'claude', 'status': 'idle', 'labels': {'firstmate.role': 'crew'},
                 'pendingPermissionCount': 0}]}))
        data = json.loads(self.fixture.read_text())
        for agent in data['agents']:
            agent['labels'].update({k: v for k, v in kept.get(agent['id'], {}).items() if k == 'usage-guard.held'})
        self.fixture.write_text(json.dumps(data))

    def call(self, *args):
        return subprocess.run([sys.executable, str(self.data / 'assets/guard.py'), *args],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def watch(self):
        return subprocess.run([sys.executable, str(HERE / 'guard.py')], env=self.env, capture_output=True, text=True,
                              timeout=20)

    def test_executable_watch_twice_in_scratch_state_is_silent(self):
        for _ in range(2):
            result = self.watch()
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
        self.assertEqual(sorted((self.home / 'stops').read_text().splitlines()), ['child', 'crew'])

    def test_watch_relays_a_change_only_when_crew_was_running(self):
        self.set_usage(20)
        self.watch()
        self.set_usage(90)
        self.assertIn('Subscription guard changed', self.watch().stdout)
        self.set_usage(20)
        data = json.loads(self.fixture.read_text())
        for agent in data['agents']:
            agent['status'] = 'idle'
        self.fixture.write_text(json.dumps(data))
        quiet = self.watch()
        self.assertEqual((quiet.returncode, quiet.stdout), (0, ''))

    def test_watch_relays_the_notice_and_status_of_a_failed_enforcement(self):
        self.set_usage(20)
        self.watch()
        self.set_usage(90)
        self.env['STOP_NOOP'] = '1'
        failed = self.watch()
        self.assertEqual(failed.returncode, 1)
        self.assertIn('Subscription guard changed', failed.stdout)

    def test_failed_bootstrap_shows_why_the_snapshot_failed(self):
        node = self.home / 'node'
        node.write_text("#!/bin/sh\necho \"Error: Cannot find module '@getpaseo/server/daemon-control'\" >&2\nexit 1\n")
        result = self.call('--bootstrap')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Paseo snapshot unavailable', result.stderr)
        self.assertIn("Cannot find module '@getpaseo/server/daemon-control'", result.stderr)

    def test_nonobject_gate_closes_and_preserves_stopped_ledger(self):
        self.call('--bootstrap')
        ledger = json.loads((self.data / 'stopped.json').read_text())
        (self.data / 'gate.json').write_text('[]')
        self.assertNotEqual(self.call('--check', 'claude').returncode, 0)
        gate = json.loads((self.data / 'gate.json').read_text())
        self.assertEqual(gate['providers'], {})
        self.assertEqual(gate['stopped'], ledger)

    def test_corrupt_ledger_does_not_leave_cached_low_gate_open(self):
        self.call('--bootstrap')
        (self.data / 'stopped.json').write_text('{bad')
        self.assertNotEqual(self.call('--check', 'claude').returncode, 0)
        self.assertEqual(json.loads((self.data / 'gate.json').read_text())['providers'], {})
        self.assertEqual((self.data / 'stopped.json').read_text(), '{bad')

    def test_baseline_silent_but_already_high_stops_only_managed_active(self):
        first = self.call()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, '')
        self.assertEqual(set((self.home / 'stops').read_text().splitlines()), {'crew', 'child'})
        second = self.call()
        self.assertEqual(second.stdout, '')
        gate = json.loads((self.data / 'gate.json').read_text())
        self.assertEqual(gate['providers']['claude']['cap'], 0)
        self.assertEqual(set(gate['stopped']), {'crew', 'child'})

    def test_pacing_overrides_file_lowers_the_hard_stop(self):
        self.set_usage(85)
        self.call()
        self.assertNotEqual(json.loads((self.data / 'gate.json').read_text())['providers']['claude']['cap'], 0)
        (self.data / 'pacing-overrides.json').write_text(json.dumps({'stop_pct': 80}))
        self.call()
        claude = json.loads((self.data / 'gate.json').read_text())['providers']['claude']
        self.assertEqual((claude['cap'], claude['reason']), (0, 'actual usage >=80%'))

    def test_claude_five_hour_window_is_dropped_since_anthropic_removed_the_limit(self):
        self.set_usage(20)
        data = json.loads(self.fixture.read_text())
        claude = data['providers'][0]
        claude['windows'] = [{'id': 'five_hour', 'usedPct': 95, 'resetsAt': claude['windows'][0]['resetsAt']},
                             {'id': 'weekly', 'usedPct': 20, 'resetsAt': datetime_iso(time.time() + 3 * 86400)}]
        self.fixture.write_text(json.dumps(data))
        self.call()
        gate = json.loads((self.data / 'gate.json').read_text())['providers']['claude']
        self.assertEqual((gate['cap'], gate['known_windows'], list(gate['projections'])),
                         (1, ['weekly'], ['weekly']))

    def test_invalid_pacing_override_closes_the_gate(self):
        self.set_usage(20)
        (self.data / 'pacing-overrides.json').write_text(json.dumps({'stop_pct': 101}))
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual(json.loads((self.data / 'gate.json').read_text())['providers'], {})

    def test_a_new_reason_alone_does_not_notify(self):
        self.set_usage(20)
        self.call()
        marker = self.home / 'watch-state/last-notice.json'
        notice = json.loads(marker.read_text())
        notice['providers']['claude']['reason'] = 'five_hour forecast 61.1% vs raise limit 75%: holding'
        marker.write_text(json.dumps(notice))
        self.assertEqual(self.call().stdout, '')

    def test_changed_state_notifies_and_check_denies(self):
        self.set_usage(20)
        self.assertEqual(self.call().stdout, '')
        self.set_usage(90)
        changed = self.call()
        self.assertIn('Subscription guard changed', changed.stdout)
        self.assertIn('information only', changed.stdout)
        self.assertEqual(self.call('--check', 'claude').returncode, 2)
        self.assertEqual(self.call().stdout, '')

    def test_history_records_the_working_agents_at_each_reading(self):
        self.set_usage(20)
        self.add_agent('elder', '2026-10-28T09:00:00+00:00', crew=True)
        self.call()
        history = json.loads((self.data / 'gate.json').read_text())['providers']['claude']['history']
        self.assertEqual(history[-1]['agents'], 2)

    def test_bootstrap_enforces_without_notifying(self):
        result = self.call('--bootstrap')
        self.assertEqual(result.stdout, '')
        self.assertEqual(set((self.home / 'stops').read_text().splitlines()), {'crew', 'child'})

    def test_cli_success_without_interruption_fails_closed_and_retries(self):
        self.env['STOP_NOOP'] = '1'
        first = self.call()
        self.assertEqual(first.returncode, 1)
        gate = json.loads((self.data / 'gate.json').read_text())
        self.assertEqual(gate['stopped'], {})
        self.assertIn('unverified', gate['enforcement_error'])
        self.call()
        self.assertEqual((self.home / 'stops').read_text().splitlines().count('child'), 2)

    def test_initializing_noop_is_not_recorded_as_stopped(self):
        data = json.loads(self.fixture.read_text())
        data['agents'][0]['status'] = 'initializing'
        self.fixture.write_text(json.dumps(data))
        self.env['STOP_NOOP'] = '1'
        self.assertEqual(self.call().returncode, 1)
        self.assertNotIn('crew', json.loads((self.data / 'gate.json').read_text())['stopped'])

    def test_malformed_gate_preserves_verified_recovery_ledger(self):
        self.assertEqual(self.call().returncode, 0)
        before = json.loads((self.data / 'gate.json').read_text())['stopped']
        (self.data / 'gate.json').write_text('{')
        self.assertEqual(self.call().returncode, 1)
        after = json.loads((self.data / 'gate.json').read_text())
        self.assertEqual(after['stopped'], before)
        self.assertEqual(after['providers'], {})

    def test_completion_race_without_cli_ack_is_not_resume_eligible(self):
        self.env['STOP_RACE'] = '1'
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual(json.loads((self.data / 'gate.json').read_text())['stopped'], {})

    def test_check_rejects_latest_high_usage_despite_cached_low_cap(self):
        self.set_usage(20)
        data = json.loads(self.fixture.read_text())
        data['providers'][0]['providerId'] = 'codex'
        data['providers'][0]['windows'][0]['id'] = 'weekly'
        for agent in data['agents']:
            agent['status'] = 'idle'
        self.fixture.write_text(json.dumps(data))
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(self.call('--check', 'codex').returncode, 0)
        data['providers'][0]['windows'][0]['usedPct'] = 90
        self.fixture.write_text(json.dumps(data))
        self.assertEqual(self.call('--check', 'codex').returncode, 2)
        self.assertEqual(json.loads((self.data / 'gate.json').read_text())['providers']['codex']['cap'], 0)

    def test_target_check_denies_current_interruption_while_provider_still_allows(self):
        self.set_usage(20)
        self.add_agent('elder', '2026-10-28T09:00:00+00:00', crew=True)
        started = time.time()
        result = self.call('--check', 'claude', '--slots', '0', '--target-agent', 'crew',
                           '--turn-started-at', str(started))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertTrue(json.loads(result.stdout)['target_interrupted'])
        self.assertEqual(self.call('--check', 'claude', '--slots', '0').returncode, 0)
        later = self.call('--check', 'claude', '--slots', '0', '--target-agent', 'crew',
                          '--turn-started-at', str(time.time()))
        self.assertEqual(later.returncode, 0, later.stderr)
        self.assertFalse(json.loads(later.stdout)['target_interrupted'])

    def calls(self):
        path = self.home / 'calls'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def labels_set(self):
        return [(c[2], c[4]) for c in self.calls() if c[:2] == ['agent', 'update']]

    def sends(self):
        return [c for c in self.calls() if c[0] == 'send']

    def set_parent(self, child, parent):
        data = json.loads(self.fixture.read_text())
        next(a for a in data['agents'] if a['id'] == child)['parentAgentId'] = parent
        self.fixture.write_text(json.dumps(data))

    def test_held_agent_is_labelled_before_it_is_stopped(self):
        self.assertEqual(self.call().returncode, 0)
        order = [(c[0], c[2] if c[0] == 'agent' else c[1]) for c in self.calls()]
        for agent_id in ('crew', 'child'):
            self.assertLess(order.index(('agent', agent_id)), order.index(('stop', agent_id)))
        self.assertEqual(sorted(self.labels_set()),
                         [('child', 'usage-guard.held=claude'), ('crew', 'usage-guard.held=claude')])

    def test_unconfirmed_stop_clears_its_hold_label(self):
        self.env['STOP_NOOP'] = '1'
        self.call()
        self.assertEqual(self.labels_set().count(('child', 'usage-guard.held=')), 1)

    def test_failed_label_keeps_the_stop_and_reports_it(self):
        self.env['LABEL_FAIL'] = '1'
        result = self.call()
        self.assertEqual(set(json.loads((self.data / 'stopped.json').read_text())), {'crew', 'child'})
        self.assertIn('label', result.stderr)

    def test_unmanaged_parent_hears_once_about_a_new_hold(self):
        self.set_parent('crew', 'human')
        self.call()
        sends = self.sends()
        self.assertEqual([s[1] for s in sends], ['human'])
        self.assertIn('--no-wait', sends[0])
        self.assertEqual(sends[0][sends[0].index('--behavior') + 1], 'steer')
        message = sends[0][sends[0].index('--prompt') + 1]
        self.assertIn('crew', message)
        self.assertIn('Do not resend, restart or replace', message)
        self.call()
        self.assertEqual(len(self.sends()), 1)

    def test_hold_label_left_by_an_interrupted_run_is_cleared(self):
        data = json.loads(self.fixture.read_text())
        data['agents'][2]['labels']['usage-guard.held'] = 'claude'
        self.fixture.write_text(json.dumps(data))
        self.call()
        self.assertIn(('human', 'usage-guard.held='), self.labels_set())

    def test_parent_stopped_in_the_same_run_or_idle_and_managed_hears_nothing(self):
        self.set_parent('crew', 'idle')
        self.call()
        self.assertEqual(self.sends(), [])

    def test_resumed_agent_leaves_the_ledger_and_loses_its_label(self):
        self.call()
        self.set_usage(20)
        self.call()
        self.assertEqual(json.loads((self.data / 'stopped.json').read_text()), {})
        self.assertIn(('child', 'usage-guard.held='), self.labels_set())
        self.assertIn(('crew', 'usage-guard.held='), self.labels_set())

    def test_watch_relays_a_hold_made_by_another_run_while_crew_was_idle(self):
        self.set_usage(20)
        data = json.loads(self.fixture.read_text())
        for agent in data['agents']:
            agent['status'] = 'idle'
        self.fixture.write_text(json.dumps(data))
        self.assertEqual(self.call().stdout, '')
        self.set_usage(90)
        self.call('--bootstrap')
        self.assertIn('Subscription guard changed', self.call().stdout)

    def add_agent(self, agent_id, created, parent=None, crew=False):
        data = json.loads(self.fixture.read_text())
        data['agents'].append({'id': agent_id, 'provider': 'claude', 'status': 'running',
                               'labels': {'firstmate.role': 'crew'} if crew else {},
                               'parentAgentId': parent, 'createdAt': created, 'pendingPermissionCount': 0})
        self.fixture.write_text(json.dumps(data))

    def set_field(self, agent_id, **fields):
        data = json.loads(self.fixture.read_text())
        next(a for a in data['agents'] if a['id'] == agent_id).update(fields)
        self.fixture.write_text(json.dumps(data))

    def test_a_waiting_manager_takes_no_slot_beside_its_running_child(self):
        self.set_usage(20)
        self.assertEqual(self.call().returncode, 0)
        self.assertFalse((self.home / 'stops').exists())
        self.assertEqual(json.loads(self.call('--check', 'claude', '--slots', '0').stdout)['active'], 1)

    def test_newest_of_two_unrelated_crews_is_stopped_at_cap_one(self):
        self.set_usage(20)
        self.add_agent('a-newer', '2026-10-28T11:00:00+00:00', crew=True)
        self.call()
        self.assertEqual((self.home / 'stops').read_text().splitlines(), ['a-newer'])

    def test_a_stopped_crew_loses_its_child_first(self):
        self.add_agent('a-boss', '2026-10-28T11:00:00+00:00', crew=True)
        self.add_agent('b-worker', '2026-10-28T11:05:00+00:00', parent='a-boss')
        self.call()
        stops = (self.home / 'stops').read_text().splitlines()
        self.assertLess(stops.index('b-worker'), stops.index('a-boss'))
        self.assertLess(stops.index('child'), stops.index('crew'))

    def add_codex_usage(self, pct):
        data = json.loads(self.fixture.read_text())
        data['providers'].append({'providerId': 'codex', 'status': 'available', 'windows': [
            {'id': 'weekly', 'usedPct': pct, 'resetsAt': data['providers'][0]['windows'][0]['resetsAt']}]})
        self.fixture.write_text(json.dumps(data))

    def test_a_manager_waiting_on_its_child_on_another_provider_takes_no_slot(self):
        self.set_usage(20)
        self.add_codex_usage(5)
        self.add_agent('boss', '2026-10-28T11:00:00+00:00', crew=True)
        self.add_agent('worker', '2026-10-28T11:05:00+00:00', parent='boss')
        self.set_field('worker', provider='codex')
        self.call()
        self.assertFalse((self.home / 'stops').exists())
        self.assertEqual(json.loads(self.call('--check', 'claude', '--slots', '0').stdout)['active'], 1)

    def test_a_manager_with_three_running_children_at_cap_one_loses_the_two_newest(self):
        self.set_usage(20)
        self.add_agent('child-2', '2026-10-28T10:40:00+00:00', parent='crew')
        self.add_agent('child-3', '2026-10-28T10:50:00+00:00', parent='crew')
        self.call()
        self.assertEqual((self.home / 'stops').read_text().splitlines(), ['child-3', 'child-2'])

    def test_an_agent_waiting_on_a_permission_is_neither_counted_nor_stopped(self):
        self.set_field('child', pendingPermissionCount=1)
        self.call()
        self.assertFalse((self.home / 'stops').exists())
        self.set_usage(20)
        self.set_field('child', pendingPermissionCount=1)
        self.assertEqual(json.loads(self.call('--check', 'claude', '--slots', '0').stdout)['active'], 0)

    def test_an_idle_agent_is_neither_counted_nor_stopped(self):
        self.set_field('child', status='idle')
        self.call()
        self.assertEqual((self.home / 'stops').read_text().splitlines(), ['crew'])
        self.set_usage(20)
        self.set_field('child', status='idle')
        self.assertEqual(json.loads(self.call('--check', 'claude', '--slots', '0').stdout)['active'], 1)

    def test_a_manager_whose_child_will_not_stop_keeps_running(self):
        self.env['STOP_FAIL_ID'] = 'child'
        self.call()
        self.assertNotIn('crew', (self.home / 'stops').read_text().splitlines())

    def test_a_manager_whose_own_stop_fails_hears_about_its_held_child(self):
        self.env['STOP_FAIL_ID'] = 'crew'
        self.call()
        self.assertEqual([s[1] for s in self.sends()], ['crew'])

    def test_a_working_manager_asking_for_its_first_child_needs_no_new_slot(self):
        self.set_usage(20)
        self.set_field('child', status='idle')
        self.assertEqual(self.call('--check', 'claude', '--slots', '1').returncode, 2)
        self.env['PASEO_AGENT_ID'] = 'crew'
        self.assertEqual(self.call('--check', 'claude', '--slots', '1').returncode, 0)

    def test_a_manager_already_waiting_on_a_child_needs_a_slot_for_another(self):
        self.set_usage(20)
        self.env['PASEO_AGENT_ID'] = 'crew'
        self.assertEqual(self.call('--check', 'claude', '--slots', '1').returncode, 2)

    def label_crew_task(self, task):
        data = json.loads(self.fixture.read_text())
        data['agents'][0]['labels']['firstmate.task'] = task
        self.fixture.write_text(json.dumps(data))

    def test_override_admits_named_task_at_stop_and_spares_its_agents(self):
        self.label_crew_task('guard-simple')
        self.assertEqual(self.call('--override', 'guard-simple', '--hours', '2').returncode, 0)
        self.assertEqual(self.call().returncode, 0)
        self.assertFalse((self.home / 'stops').exists())
        named = self.call('--check', 'claude', '--task', 'guard-simple')
        self.assertEqual(named.returncode, 0, named.stderr)
        self.assertTrue(json.loads(named.stdout)['override'])
        self.assertEqual(self.call('--check', 'claude', '--task', 'other').returncode, 2)
        self.assertEqual(self.call('--check', 'claude').returncode, 2)

    def test_overridden_task_agents_do_not_count_against_cap(self):
        self.set_usage(20)
        self.label_crew_task('guard-simple')
        self.call('--override', 'guard-simple', '--hours', '2')
        result = self.call('--check', 'claude', '--slots', '0')
        self.assertEqual(json.loads(result.stdout)['active'], 0)

    def test_removed_or_expired_override_no_longer_admits(self):
        self.label_crew_task('guard-simple')
        self.call('--override', 'guard-simple', '--hours', '2')
        self.call('--override', 'guard-simple', '--hours', '0')
        self.assertEqual(self.call('--check', 'claude', '--task', 'guard-simple').returncode, 2)
        (self.data / 'overrides.json').write_text(json.dumps({'guard-simple': {'until': time.time() - 1}}))
        self.assertEqual(self.call('--check', 'claude', '--task', 'guard-simple').returncode, 2)
        self.assertEqual(set((self.home / 'stops').read_text().splitlines()), {'crew', 'child'})

    def test_corrupt_gate_check_fails_closed(self):
        (self.data / 'gate.json').write_text('{')
        self.assertEqual(self.call('--check', 'claude').returncode, 1)
        gate = json.loads((self.data / 'gate.json').read_text())
        self.assertEqual(gate['providers'], {})


def datetime_iso(stamp):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat()



class SnapshotRetryTest(unittest.TestCase):
    def live(self, status):
        return {'providers': [{'providerId': 'claude', 'status': status, 'windows': []}], 'agents': [], 'bases': {}}

    def test_unavailable_or_failed_snapshot_is_retried_once_after_a_pause(self):
        import guard
        for first in ((self.live('unavailable'), '/cli'), RuntimeError('Paseo snapshot failed')):
            with self.subTest(first=first), patch.object(guard.time, 'sleep') as pause, \
                 patch.object(guard, 'snapshot', side_effect=[first, (self.live('available'), '/cli')]) as read:
                self.assertEqual(guard.snapshot_with_retry({}), (self.live('available'), '/cli'))
                pause.assert_called_once_with(guard.RETRY_SECONDS)
                self.assertEqual(read.call_count, 2)

    def test_available_snapshot_is_not_retried(self):
        import guard
        with patch.object(guard.time, 'sleep') as pause, \
             patch.object(guard, 'snapshot', return_value=(self.live('available'), '/cli')):
            guard.snapshot_with_retry({})
        pause.assert_not_called()


if __name__ == '__main__':
    unittest.main()
