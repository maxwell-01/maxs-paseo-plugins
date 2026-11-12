import subprocess
import sys

HOLD_LABEL = 'usage-guard.held'
LIVE = ('running', 'initializing')
CLI_TIMEOUT_SECONDS = 5


def paseo_succeeded(cli, paseo_home, *args):
    try:
        return subprocess.run([cli, *args, '--home', paseo_home], capture_output=True, text=True,
                              timeout=CLI_TIMEOUT_SECONDS).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def set_hold_label(cli, paseo_home, agent_id, provider):
    if not paseo_succeeded(cli, paseo_home, 'agent', 'update', agent_id, '--label', f'{HOLD_LABEL}={provider}'):
        print(f'Usage hold label not updated on {agent_id}', file=sys.stderr)


def clear_hold_label(cli, paseo_home, agent_id):
    set_hold_label(cli, paseo_home, agent_id, '')


def resumed_agent_ids(stopped, agents, stopping):
    status = {a['id']: a['status'] for a in agents}
    return [agent_id for agent_id in stopped if status.get(agent_id) in LIVE and agent_id not in stopping]


def stale_hold_ids(agents, labelled, stopped):
    shown = {a['id'] for a in agents if (a.get('labels') or {}).get(HOLD_LABEL)}
    return sorted((shown | labelled) - set(stopped))


def hold_message(holds, providers):
    held = ', '.join(f"{agent_id} ({key}: {providers[key]['reason']})" for agent_id, key in sorted(holds.items()))
    return (f'Subscription usage guard held {held}. Do not resend, restart or replace them: whoever runs this '
            f'work resumes them when usage allows. Until then each has the label {HOLD_LABEL}=<provider>. '
            'This is information from the guard, not a task.')


def tell_parents(cli, paseo_home, new_holds, agents, managed_ids, providers):
    by_id = {a['id']: a for a in agents}
    by_parent = {}
    for agent_id, key in new_holds.items():
        parent = by_id.get(by_id.get(agent_id, {}).get('parentAgentId'))
        if parent and (parent['id'] not in managed_ids or parent['status'] == 'running'):
            by_parent.setdefault(parent['id'], {})[agent_id] = key
    for parent_id, holds in by_parent.items():
        if not paseo_succeeded(cli, paseo_home, 'send', parent_id, '--no-wait', '--behavior', 'steer', '--prompt',
                               hold_message(holds, providers)):
            print(f'Usage hold not reported to parent {parent_id}', file=sys.stderr)
