import unittest

from guard import managed_agents

FIRSTMATE_CONFIG = {'managed_labels': ['firstmate.role=crew'], 'manager_labels': ['firstmate.role=first-mate'],
                    'task_label': 'firstmate.task'}


def agent(agent_id, parent=None, archived=False, **labels):
    return {'id': agent_id, 'parentAgentId': parent, 'labels': labels, 'archivedAt': '2026-01-01' if archived else None}


def ids(agents, config, overridden=()):
    return sorted(a['id'] for a in managed_agents(agents, config, set(overridden)))


class ManageEveryAgentByDefaultTests(unittest.TestCase):
    AGENTS = [agent('plain'), agent('child', parent='plain'), agent('gone', archived=True),
              agent('task', **{'usage-pacer.task': 'big'}), agent('task-child', parent='task')]

    def test_every_live_agent_is_managed(self):
        self.assertEqual(ids(self.AGENTS, {}), ['child', 'plain', 'task', 'task-child'])

    def test_empty_label_lists_still_mean_every_agent(self):
        self.assertEqual(ids(self.AGENTS, {'managed_labels': [], 'manager_labels': []}),
                          ['child', 'plain', 'task', 'task-child'])

    def test_an_overridden_task_and_its_descendants_are_not_managed(self):
        self.assertEqual(ids(self.AGENTS, {}, {'big'}), ['child', 'plain'])

    def test_the_task_label_key_is_configurable(self):
        agents = [agent('a', job='x'), agent('b')]
        self.assertEqual(ids(agents, {'task_label': 'job'}, {'x'}), ['b'])


class NarrowedScopeTests(unittest.TestCase):
    AGENTS = [agent('boss', role='lead'), agent('report', parent='boss'), agent('grandchild', parent='report'),
              agent('crew', role='crew'), agent('crew-child', parent='crew'), agent('loner'),
              agent('root'), agent('root-child', parent='root')]

    def test_managed_label_covers_the_agent_and_its_descendants(self):
        self.assertEqual(ids(self.AGENTS, {'managed_labels': ['role=crew']}), ['crew', 'crew-child'])

    def test_manager_label_covers_its_children_not_the_manager(self):
        self.assertEqual(ids(self.AGENTS, {'manager_labels': ['role=lead']}), ['grandchild', 'report'])

    def test_roots_and_their_descendants_are_added(self):
        config = {'managed_labels': ['role=crew'], 'managed_roots': ['root']}
        self.assertEqual(ids(self.AGENTS, config), ['crew', 'crew-child', 'root', 'root-child'])

    def test_an_overridden_agent_is_not_a_seed_so_only_a_labelled_descendant_stays_managed(self):
        agents = [agent('crew', role='crew', task='t'), agent('inner', parent='crew', role='crew'),
                  agent('plain-child', parent='crew')]
        self.assertEqual(ids(agents, {'managed_labels': ['role=crew'], 'task_label': 'task'}, {'t'}), ['inner'])


class FirstMateConfigTests(unittest.TestCase):
    def test_manages_crew_the_first_mates_children_roots_and_descendants_only(self):
        agents = [agent('fm', **{'firstmate.role': 'first-mate'}),
                  agent('crew', **{'firstmate.role': 'crew'}), agent('crew-child', parent='crew'),
                  agent('fm-child', parent='fm'), agent('fm-grandchild', parent='fm-child'),
                  agent('root'), agent('root-child', parent='root'), agent('unlabelled'),
                  agent('done', **{'firstmate.role': 'crew'}, archived=True),
                  agent('paused', **{'firstmate.role': 'crew', 'firstmate.task': 'hold-me'})]
        config = dict(FIRSTMATE_CONFIG, managed_roots=['root'])
        self.assertEqual(ids(agents, config, {'hold-me'}),
                         ['crew', 'crew-child', 'fm-child', 'fm-grandchild', 'root', 'root-child'])


class ConfigValidationTests(unittest.TestCase):
    def test_wrong_types_fail_closed(self):
        for config in ({'managed_labels': 'a=b'}, {'managed_labels': ['nokey']}, {'manager_labels': [1]},
                       {'task_label': 3}, {'task_label': ''}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                managed_agents([agent('a')], config, set())


if __name__ == '__main__':
    unittest.main()
