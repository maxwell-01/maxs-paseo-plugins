import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pace


class SharingSwitchTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        home = patch.dict(os.environ, HOME=temp.name)
        home.start()
        self.addCleanup(home.stop)

    def write(self, text):
        path = self.home / '.claude/paced-workflows/sharing.json'
        path.parent.mkdir(parents=True)
        path.write_text(text)

    def test_sharing_off_in_the_file_pauses(self):
        self.write(json.dumps({'sharing': 'off'}))
        self.assertEqual(pace.read_sharing(), 'off')

    def test_sharing_on_in_the_file_runs(self):
        self.write(json.dumps({'sharing': 'on'}))
        self.assertEqual(pace.read_sharing(), 'on')

    def test_no_file_means_sharing_on(self):
        self.assertEqual(pace.read_sharing(), 'on')

    def test_a_corrupt_file_means_sharing_on(self):
        self.write('{not json')
        self.assertEqual(pace.read_sharing(), 'on')


if __name__ == '__main__':
    unittest.main()
