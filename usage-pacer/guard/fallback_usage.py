import json

FALLBACK_NAME = 'fallback-usage.json'
FALLBACK_MAX_AGE = 900


def unreadable_fallback(problem):
    return None, f'{FALLBACK_NAME} {problem}'


def valid_windows(windows):
    return isinstance(windows, list) and all(isinstance(w, dict) and isinstance(w.get('id'), str) for w in windows)


def fallback_usage(data_dir, provider):
    try:
        readings = json.loads((data_dir / FALLBACK_NAME).read_text())
    except FileNotFoundError:
        return None, None
    except OSError as failure:
        return unreadable_fallback(f'cannot be read: {failure}')
    except ValueError as failure:
        return unreadable_fallback(f'is not valid JSON: {failure}')
    if not isinstance(readings, dict):
        return unreadable_fallback('must be a JSON object')
    if provider not in readings:
        return None, None
    entry = readings[provider]
    if not isinstance(entry, dict) or not valid_windows(entry.get('windows', [])):
        return unreadable_fallback(f'{provider} entry must be an object with a list of window objects')
    return dict(entry, status='available'), None


def weekly_windows_still_open(previous, present_ids, now):
    history = previous.get('history') or [{}]
    return [w for key, w in history[-1].get('windows', {}).items()
            if key.startswith('weekly') and key not in present_ids and w['resetsAt'] > now]
