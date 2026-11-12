import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from guard import app_bundle_runtime  # noqa: E402


def stub(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(0o755)
    return path


class StandaloneGuardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.paseo_home = Path(temp.name)
        self.state = self.paseo_home / 'plugin-data/usage-pacer'
        self.state.mkdir(parents=True)
        reset = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3 * 86400))
        (self.state / 'usage.json').write_text(json.dumps({
            'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'bases': {}, 'agents': [],
            'providers': [{'providerId': 'claude', 'status': 'available',
                           'windows': [{'id': 'weekly', 'usedPct': 10, 'resetsAt': reset}]}]}))
        self.node = stub(self.paseo_home / 'node',
                         f'#!/bin/sh\necho "$@" > {self.state}/node-args\nexec cat {self.state}/usage.json\n')
        self.cli = stub(self.paseo_home / 'bin/paseo', '#!/bin/sh\nexit 0\n')
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ('USAGE_PACER_STATE', 'USAGE_PACER_NOTICE_STATE', 'PASEO_CLI', 'PASEO_AGENT_ID')}
        self.guard_dir = self.state / 'guard'
        self.guard_dir.mkdir()
        for source in HERE.iterdir():
            if source.suffix in ('.py', '.json', '.mjs') and not source.name.startswith('test_'):
                shutil.copy(source, self.guard_dir / source.name)

    def run_guard(self, *args):
        return subprocess.run([sys.executable, str(self.guard_dir / 'guard.py'), *args], env=self.env,
                              capture_output=True, text=True, timeout=20)

    def test_state_is_the_folder_above_the_real_guard_when_called_through_a_symlink(self):
        link = self.paseo_home / 'linked/guard.py'
        link.parent.mkdir()
        link.symlink_to(self.guard_dir / 'guard.py')
        result = subprocess.run([sys.executable, str(link), '--override', 't', '--hours', '1'], env=self.env,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('t', json.loads((self.state / 'overrides.json').read_text()))
        self.assertFalse((link.parent / 'overrides.json').exists())

    def test_runs_with_no_config_file_and_derives_paseo_home_from_the_state_folder(self):
        self.env['PASEO_CLI'] = str(self.cli)
        self.env['PATH'] = str(self.node.parent) + os.pathsep + self.env['PATH']
        result = self.run_guard('--bootstrap')
        self.assertEqual((result.returncode, result.stderr), (0, ''))
        self.assertEqual((self.state / 'node-args').read_text().split(),
                         [str(self.guard_dir / 'paseo-source.mjs'), str(self.cli), str(self.paseo_home)])
        self.assertTrue((self.state / 'gate.json').exists())

    def test_picks_the_app_bundle_runtime_when_the_config_names_no_node(self):
        resources = self.paseo_home / 'Paseo.app/Contents/Resources'
        (resources / 'app.asar').parent.mkdir(parents=True)
        (resources / 'app.asar').write_text('')
        cli = stub(resources / 'bin/paseo', '#!/bin/sh\nexit 0\n')
        helper = stub(resources.parent / 'Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper',
                      self.node.read_text())
        sdk = str(resources / 'app.asar/node_modules/@getpaseo/cli/dist/index.js')
        self.assertEqual(app_bundle_runtime(str(cli)), {'node': str(helper), 'sdk': sdk})
        self.env['PASEO_CLI'] = str(cli)
        self.assertEqual(self.run_guard('--bootstrap').returncode, 0)
        self.assertEqual((self.state / 'node-args').read_text().split()[1], sdk)

    def test_no_app_bundle_means_no_runtime_override(self):
        self.assertEqual(app_bundle_runtime(str(self.cli)), {})

    def test_notice_baseline_defaults_to_the_state_folder_and_follows_the_env(self):
        (self.state / 'config.json').write_text(json.dumps({'cli': str(self.cli), 'node': str(self.node)}))
        self.run_guard()
        self.assertTrue((self.state / 'watch-state/last-notice.json').exists())
        self.env['USAGE_PACER_NOTICE_STATE'] = str(self.paseo_home / 'elsewhere')
        self.run_guard()
        self.assertTrue((self.paseo_home / 'elsewhere/last-notice.json').exists())


if __name__ == '__main__':
    unittest.main()
