import unittest
from unittest.mock import patch

import policy

NOW = 1800000000


def usage(at, reset=NOW+18000, weekly=66, session=3):
    return {'status':'available', 'fetchedAt':at, 'windows':[
        {'id':'five_hour', 'usedPct':session, 'resetsAt':reset},
        {'id':'weekly', 'usedPct':weekly, 'resetsAt':NOW+604800},
        {'id':'weekly_model', 'usedPct':20, 'resetsAt':NOW+604800}]}


class ReopenAndStaleUsageTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def observe(self, reset=NOW+18000):
        state = policy.decide(usage(NOW-3600, reset=reset, weekly=90), {}, NOW-3600)
        for offset in range(-3300, 1, 300):
            state = policy.decide(usage(NOW+offset, reset=reset), state, NOW+offset)
        return state

    def test_weekly_below_ninety_reopens(self):
        self.assertGreater(self.observe()['cap'], 0)

    def test_each_actual_window_at_ninety_stops_new_work(self):
        for index in range(3):
            data = usage(NOW)
            data['windows'][index]['usedPct'] = 90
            self.assertEqual(policy.decide(data, {}, NOW)['cap'], 0)
            data['windows'][index]['usedPct'] = 89
            self.assertEqual(policy.decide(data, {}, NOW)['cap'], 1)

    def test_recent_reset_keeps_cap_and_confirmed_next_period(self):
        state = self.observe(reset=NOW+30)
        cap = state['cap']
        self.assertGreater(cap, 0)
        state = policy.decide(usage(NOW+300, reset=NOW+30, session=95), state, NOW+300)
        self.assertEqual(state['cap'], cap)
        state = policy.decide(usage(NOW+600, reset=NOW+18030, session=0), state, NOW+600)
        self.assertEqual(state['cap'], cap)

    def test_stale_usage_and_reset_outside_grace_step_down_after_hold(self):
        state = self.observe()
        self.assertEqual(policy.decide(usage(NOW-301), state, NOW)['cap'], state['cap'])
        stepped = max(1, state['cap'] - 1)
        self.assertEqual(policy.decide(usage(NOW+700), state, NOW+1001)['cap'], stepped)
        self.assertEqual(policy.decide(usage(NOW+1001, reset=NOW-800), state, NOW+1001)['cap'], stepped)
