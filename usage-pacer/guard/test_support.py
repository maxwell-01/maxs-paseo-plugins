import json

FIRSTMATE_CONFIG = {'managed_labels': ['firstmate.role=crew'], 'manager_labels': ['firstmate.role=first-mate'],
                    'task_label': 'firstmate.task'}

STUB_PASEO_CLI = """#!/usr/bin/env python3
import json, os, pathlib, sys
home = pathlib.Path(os.environ['USAGE_PACER_STATE'])
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
"""


def install_stub_paseo(home, **config):
    cli = home / 'paseo'
    cli.write_text(STUB_PASEO_CLI)
    cli.chmod(0o755)
    node = home / 'node'
    node.write_text("#!/bin/sh\nexec cat \"$USAGE_PACER_STATE/usage.json\"\n")
    node.chmod(0o755)
    (home / 'config.json').write_text(json.dumps({'cli': str(cli), 'node': str(node), **config}))
    return cli
