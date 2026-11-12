import os
from pathlib import Path


def state_dir():
    configured = os.environ.get('USAGE_PACER_STATE')
    return Path(configured) if configured else Path(__file__).resolve().parent.parent
