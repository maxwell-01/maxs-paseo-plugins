from test_policy import policy
import unittest
from unittest.mock import patch


MONDAY = [
    (1793021870.762, 0, 5, 0, 7, 1793039400), (1793022051.09, 0, 5, 0, 7, 1793039400),
    (1793022230.438, 0, 5, 0, 7, 1793039400), (1793022410.834, 0, 5, 0, 7, 1793039400),
    (1793022590.448, 0, 5, 0, 7, 1793039400), (1793022770.463, 0, 5, 0, 7, 1793039400),
    (1793022950.464, 2, 5, 1, 7, 1793039400), (1793023130.474, 2, 5, 0, 7, 1793039400),
    (1793023310.47, 3, 5, 0, 7, 1793039400), (1793023449.386, 3, 5, 0, 7, 1793039400),
    (1793023670.471, 4, 5, 0, 7, 1793039400), (1793024030.765, 5, 5, 0, 7, 1793039400),
    (1793024390.486, 5, 5, 0, 7, 1793039401), (1793024750.469, 5, 5, 0, 7, 1793039401),
    (1793025110.506, 5, 5, 0, 7, 1793039401), (1793025470.492, 5, 5, 0, 7, 1793039401),
    (1793025770.927, 6, 5, 0, 7, 1793039401), (1793025890.507, 6, 5, 0, 7, 1793039401),
    (1793026080.646, 6, 5, 0, 7, 1793039400), (1793026250.97, 6, 5, 0, 7, 1793039400),
    (1793026430.52, 6, 5, 0, 7, 1793039401), (1793026610.545, 6, 5, 0, 7, 1793039401),
    (1793026790.52, 6, 5, 0, 7, 1793039401), (1793026970.503, 6, 5, 0, 7, 1793039401),
    (1793027150.502, 6, 5, 0, 7, 1793039400), (1793027271.171, 6, 5, 1, 7, 1793039400),
    (1793027510.843, 7, 6, 1, 7, 1793039400), (1793027630.974, 7, 6, 1, 7, 1793039400),
    (1793027870.538, 7, 6, 0, 7, 1793039400), (1793027990.902, 7, 6, 0, 7, 1793039400),
    (1793028171.298, 8, 6, 0, 7, 1793039400), (1793028350.893, 8, 6, 0, 7, 1793039400),
    (1793028531.373, 8, 6, 0, 7, 1793039400), (1793028711.008, 8, 6, 1, 7, 1793039400),
    (1793028891.264, 11, 6, 1, 7, 1793039400), (1793029071.011, 11, 6, 2, 7, 1793039400),
    (1793029251.228, 12, 6, 2, 1, 1793039400), (1793029430.927, 12, 6, 0, 2, 1793039400),
]

TUESDAY = [
    (1793080816.071, 1, 12, 0, 3, 1793093400),
    (1793091412.723, 2, 13, 0, 1, 1793093401), (1793091751.137, 3, 13, 0, 1, 1793093400),
    (1793092072.122, 3, 13, 1, 2, 1793093400), (1793092432.105, 4, 13, 0, 2, 1793093400),
    (1793092792.114, 4, 13, 0, 2, 1793093400), (1793093152.13, 6, 13, 1, 2, 1793093400),
    (1793093512.118, 0, 13, 1, 2, 1793111400), (1793093872.126, 2, 14, 0, 2, 1793111400),
    (1793094172.526, 4, 14, 2, 2, 1793111401), (1793094232.127, 6, 14, 1, 2, 1793111401),
    (1793094481.378, 6, 14, 0, 2, 1793111401), (1793094832.174, 8, 15, 0, 1, 1793111400),
    (1793095192.198, 10, 15, 0, 1, 1793111401), (1793095552.198, 12, 15, 0, 1, 1793111400),
    (1793095912.198, 15, 16, 0, 1, 1793111400), (1793096212.506, 16, 16, 2, 1, 1793111401),
    (1793096572.417, 18, 16, 1, 1, 1793111401),
]


WEDNESDAY = [
    (1793199531.783, 22, 40, 0, 1, 1793212201), (1793199591.78, 22, 40, 1, 1, 1793212201),
    (1793199834.612, 25, 40, 1, 1, 1793212200), (1793199952.099, 25, 40, 1, 1, 1793212200),
    (1793200140.769, 26, 40, 1, 1, 1793212201), (1793200261.715, 26, 40, 0, 1, 1793212201),
    (1793200461.578, 28, 40, 0, 1, 1793212200), (1793200612.332, 28, 40, 0, 1, 1793212200),
    (1793200791.787, 29, 41, 0, 1, 1793212200), (1793200972.126, 29, 41, 0, 1, 1793212200),
    (1793201116.343, 29, 41, 1, 1, 1793212200), (1793201331.837, 29, 41, 1, 1, 1793212200),
    (1793201451.909, 30, 41, 1, 1, 1793212200), (1793201684.168, 30, 41, 0, 1, 1793212200),
    (1793201991.895, 30, 41, 0, 1, 1793212200), (1793202112.265, 30, 41, 1, 1, 1793212200),
    (1793202292.218, 30, 41, 1, 1, 1793212200), (1793202472.241, 31, 41, 0, 1, 1793212200),
    (1793202652.329, 31, 41, 1, 1, 1793212200), (1793202800.004, 33, 41, 1, 1, 1793212200),
    (1793203012.225, 33, 41, 1, 1, 1793212200), (1793203131.988, 37, 42, 0, 1, 1793212200),
    (1793203372.311, 37, 42, 0, 1, 1793212200), (1793203492.469, 37, 42, 0, 1, 1793212201),
    (1793203732.358, 37, 42, 0, 1, 1793212201), (1793203852.043, 38, 42, 0, 1, 1793212201),
    (1793204092.664, 38, 42, 0, 1, 1793212201), (1793204212.077, 39, 42, 0, 1, 1793212201),
    (1793204452.834, 39, 42, 0, 1, 1793212201), (1793204572.107, 39, 42, 0, 1, 1793212201),
    (1793204812.692, 39, 42, 0, 1, 1793212201), (1793204932.129, 40, 42, 1, 1, 1793212201),
]

def recorded_reading(row):
    stamp, short, weekly, _, _, reset = row
    return {'status': 'available', 'fetchedAt': stamp, 'windows': [
        {'id': 'five_hour', 'usedPct': short, 'resetsAt': reset},
        {'id': 'weekly', 'usedPct': weekly, 'resetsAt': 1793574000}]}


def recorded_state(rows):
    return {'cap': rows[-1][4], 'history': [
        {'ts': row[0], 'windows': {w['id']: w for w in recorded_reading(row)['windows']},
         'agents': row[3], 'cap': row[4], 'action': 'hold'} for row in rows]}


class RecordedPeakTests(unittest.TestCase):
    def setUp(self):
        sharing = patch.object(policy.pace, 'read_sharing', return_value='on')
        sharing.start()
        self.addCleanup(sharing.stop)

    def test_monday_1540_keeps_the_two_running_agents(self):
        row = MONDAY[-2]
        result = policy.decide(recorded_reading(row), recorded_state(MONDAY[:-2]), row[0], agents=row[3])
        self.assertEqual(result['cap'], 7)

    def test_monday_afternoon_never_caps_below_the_running_crew(self):
        state = recorded_state(MONDAY[:16])
        for row in MONDAY[16:]:
            state = policy.decide(recorded_reading(row), state, row[0], agents=row[3])
            self.assertGreaterEqual(state['cap'], row[3], row)

    def test_tuesday_0931_to_1022_never_stops_running_work(self):
        start = next(i for i, row in enumerate(TUESDAY) if row[0] >= 1793093400)
        state = recorded_state(TUESDAY[:start])
        for row in TUESDAY[start:]:
            state = policy.decide(recorded_reading(row), state, row[0], agents=row[3])
            self.assertGreaterEqual(state['cap'], row[3], row)

    def test_fifteen_minute_peak_after_monday_1537_stops_no_agent(self):
        for remaining in (0, 1):
            state = recorded_state(MONDAY[:-2])
            stamp, pct, weekly, _, _, reset = MONDAY[-3]
            state['cap'] = 10
            state['history'][-1]['agents'] = 10
            for minute in range(3, 91, 3):
                prior_agents = 10 if minute <= 15 else remaining
                pct += 3 * (0.07 + 0.1 * prior_agents)
                agents = 10 if minute < 15 else remaining
                row = (stamp + minute * 60, round(pct), weekly, agents, 10, reset)
                state = policy.decide(recorded_reading(row), state, row[0], agents=agents)
                self.assertGreaterEqual(state['cap'], agents, (remaining, minute, pct))

    def test_sustained_burn_after_monday_1537_preserves_the_reserve(self):
        state = recorded_state(MONDAY[:-2])
        stamp, pct, weekly, _, _, reset = MONDAY[-3]
        state['cap'] = agents = 10
        state['history'][-1]['agents'] = agents
        first_stop = None
        for minute in range(3, 169, 3):
            pct += 3 * (0.07 + 0.1 * agents)
            row = (stamp + minute * 60, round(pct), weekly, agents, 10, reset)
            state = policy.decide(recorded_reading(row), state, row[0], agents=agents)
            if state['cap'] < agents and first_stop is None:
                first_stop = pct
            agents = min(agents, state['cap'])
        self.assertIsNotNone(first_stop)
        self.assertGreaterEqual(first_stop, 75)
        self.assertLess(first_stop, 85)
        self.assertLess(pct, 100)
        self.assertEqual(state['cap'], 0)

    def test_wednesday_1628_weekly_forecast_under_ninety_raises_the_cap(self):
        row = WEDNESDAY[-1]
        result = policy.decide(recorded_reading(row), recorded_state(WEDNESDAY[:-1]), row[0], agents=row[3])
        self.assertEqual(result['cap'], 2)
        self.assertIn('weekly forecast 78.2% vs raise limit 90%: both windows comfortably safe', result['reason'])

    def test_wednesday_1626_names_every_window_holding_the_cap(self):
        row = WEDNESDAY[-2]
        with patch.dict(policy.CONFIG, weekly_target_pct=75):
            result = policy.decide(recorded_reading(row), recorded_state(WEDNESDAY[:-2]), row[0], agents=row[3])
        self.assertEqual(result['reason'], 'five_hour forecast 64.7% vs raise limit 75%: holding: no burn per agent '
                         'measured yet and the crew does not fill the cap; weekly forecast 78.2% vs raise limit 75%: '
                         'holding: not comfortably clear of both ceilings')
