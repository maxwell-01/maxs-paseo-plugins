import unittest
from unittest.mock import patch

from test_policy import NOW, policy, reading

OCTOBER_31_WEEKLY_RESET = 1793574000
OCTOBER_31_FIVE_HOUR_RESET = 1793424000
OCTOBER_31_FIVE_HOUR_READINGS = [
    (1793416039, 5), (1793416359, 6), (1793416682, 6), (1793416999, 6),
    (1793417660, 6), (1793418020, 6), (1793418380, 6), (1793418740, 6),
]
OCTOBER_31_FIRST_NULL_POLL_AT = 1793419100


def october_31_reading(at, five_hour_pct=None):
    windows = [{'id': 'weekly', 'usedPct': 77, 'resetsAt': OCTOBER_31_WEEKLY_RESET},
               {'id': 'weekly_model_fable', 'usedPct': 30, 'resetsAt': OCTOBER_31_WEEKLY_RESET}]
    if five_hour_pct is not None:
        windows.insert(0, {'id': 'five_hour', 'usedPct': five_hour_pct, 'resetsAt': OCTOBER_31_FIVE_HOUR_RESET})
    return {'status': 'available', 'fetchedAt': at, 'windows': windows}


class AbsentWindowTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def last_good_state(self):
        state = {}
        for at, pct in OCTOBER_31_FIVE_HOUR_READINGS:
            state = policy.decide(october_31_reading(at, pct), state, at, agents=0)
        return state

    def test_claude_dropping_its_five_hour_window_is_paced_on_the_weekly_windows(self):
        at = OCTOBER_31_FIRST_NULL_POLL_AT
        result = policy.decide(october_31_reading(at), self.last_good_state(), at, agents=0)
        self.assertEqual(result['projections'], {'weekly': 77.0, 'weekly_model_fable': 30.0})
        self.assertEqual(result['known_windows'], ['weekly', 'weekly_model_fable'])
        self.assertEqual((result['mode'], result['cap']), ('paced', 2))

    def test_a_vanished_weekly_window_still_holds_the_last_good_reading(self):
        state = self.last_good_state()
        at = OCTOBER_31_FIRST_NULL_POLL_AT
        data = october_31_reading(at, 6)
        data['windows'] = [w for w in data['windows'] if w['id'] != 'weekly']
        result = policy.decide(data, state, at, agents=0)
        self.assertEqual((result['cap'], result['reason']),
                         (state['cap'], 'weekly window disappeared; holding last good reading'))

    def test_lost_model_window_is_paced_without_it(self):
        data = reading()
        data['windows'].append({'id': 'model', 'usedPct': 20, 'resetsAt': NOW + 1000})
        state = policy.decide(data, {}, NOW)
        result = policy.decide(reading(stamp=NOW + 180), state, NOW + 180)
        self.assertEqual(result['known_windows'], ['session', 'weekly'])
        self.assertEqual(result['projections'], {'session': 20.0, 'weekly': 28.6})
        self.assertEqual((result['mode'], result['cap']), ('throttled', 1))


if __name__ == '__main__':
    unittest.main()
