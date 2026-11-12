import unittest

from slots import stop_order, working_agents


def agent(agent_id, created, provider='claude', permissions=0):
    return {'id': agent_id, 'provider': provider, 'createdAt': created, 'pendingPermissionCount': permissions}


def manager_with_children(count, provider='claude'):
    agents = [agent('manager', 0)] + [agent(f'child-{n}', n, provider) for n in range(1, count + 1)]
    return agents, {a['id']: 'manager' for a in agents[1:]}


def provider_of(agents):
    return {a['id']: a['provider'] for a in agents}


def ids(agents):
    return [a['id'] for a in agents]


def created_at(a):
    return a['createdAt']


class WorkingAgentsTests(unittest.TestCase):
    def test_a_lone_agent_takes_one_slot(self):
        self.assertEqual(ids(working_agents([agent('lone', 0)], {})), ['lone'])

    def test_a_manager_with_ten_running_children_takes_ten_slots(self):
        agents, parent_of = manager_with_children(10)
        working = working_agents(agents, parent_of)
        self.assertEqual(len(working), 10)
        self.assertNotIn('manager', ids(working))

    def test_a_manager_with_one_running_child_takes_one_slot(self):
        agents, parent_of = manager_with_children(1)
        self.assertEqual(ids(working_agents(agents, parent_of)), ['child-1'])

    def test_a_manager_waits_on_a_running_grandchild_under_an_idle_child(self):
        agents = [agent('manager', 0), agent('grandchild', 2)]
        parent_of = {'idle-child': 'manager', 'grandchild': 'idle-child'}
        self.assertEqual(ids(working_agents(agents, parent_of)), ['grandchild'])

    def test_an_agent_waiting_on_a_permission_takes_no_slot(self):
        agents = [agent('asking', 0, permissions=1), agent('working', 1)]
        self.assertEqual(ids(working_agents(agents, {})), ['working'])


class StopOrderTests(unittest.TestCase):
    def test_cap_four_stops_the_six_newest_children_and_never_the_manager(self):
        agents, parent_of = manager_with_children(10)
        order = stop_order(agents, parent_of, provider_of(agents), {'claude': 4}, created_at)
        self.assertEqual(ids(order), [f'child-{n}' for n in range(10, 4, -1)])

    def test_a_manager_and_its_running_child_fit_cap_one(self):
        agents, parent_of = manager_with_children(1)
        self.assertEqual(stop_order(agents, parent_of, provider_of(agents), {'claude': 1}, created_at), [])

    def test_a_paused_provider_stops_the_child_before_its_manager(self):
        agents, parent_of = manager_with_children(1)
        order = stop_order(agents, parent_of, provider_of(agents), {'claude': 0}, created_at)
        self.assertEqual(ids(order), ['child-1', 'manager'])

    def test_the_newest_of_two_unrelated_roots_is_stopped(self):
        agents = [agent('older', 0), agent('newer', 1)]
        order = stop_order(agents, {}, provider_of(agents), {'claude': 1}, created_at)
        self.assertEqual(ids(order), ['newer'])

    def test_a_manager_waiting_on_a_child_on_another_provider_takes_no_slot(self):
        agents = [agent('elder', 0), agent('manager', 1), agent('worker', 2, provider='codex')]
        order = stop_order(agents, {'worker': 'manager'}, provider_of(agents), {'claude': 1, 'codex': 1}, created_at)
        self.assertEqual(order, [])

    def test_only_working_agents_on_the_provider_over_its_cap_are_stopped(self):
        agents, parent_of = manager_with_children(2, provider='codex')
        agents.append(agent('claude-worker', 3))
        order = stop_order(agents, parent_of, provider_of(agents), {'claude': 1, 'codex': 1}, created_at)
        self.assertEqual(ids(order), ['child-2'])

    def test_a_paused_provider_never_stops_an_agent_waiting_on_a_permission(self):
        agents = [agent('asking', 1, permissions=1)]
        self.assertEqual(stop_order(agents, {}, provider_of(agents), {'claude': 0}, created_at), [])


if __name__ == '__main__':
    unittest.main()
