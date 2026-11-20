import json

FALLBACK_NAME = 'fallback-usage.json'
FALLBACK_MAX_AGE = 900


def unreadable(problem):
    return {'status': 'error', 'problem': f'{FALLBACK_NAME} {problem}'}


def fallback_usage(data_dir, provider):
    try:
        readings = json.loads((data_dir / FALLBACK_NAME).read_text())
    except FileNotFoundError:
        return None
    except ValueError as failure:
        return unreadable(f'is not valid JSON: {failure}')
    if not isinstance(readings, dict):
        return unreadable('must be a JSON object')
    if provider not in readings:
        return None
    if not isinstance(readings[provider], dict):
        return unreadable(f'{provider} entry must be a JSON object')
    return dict(readings[provider], status='available')
