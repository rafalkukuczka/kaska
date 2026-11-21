"""Track provider requests that can consume credits or add usage costs."""
from collections import Counter
from contextlib import contextmanager
import re
import threading
import time


NOTICE_SECONDS = 6
OUTREACH_LEASE_SECONDS = 75
_lock = threading.Lock()
_running = Counter()
_recent = {}
_outreach = {}


@contextmanager
def track(provider):
    if not provider:
        yield
        return
    with _lock:
        _running[provider] += 1
    try:
        yield
    finally:
        with _lock:
            _running[provider] -= 1
            _recent[provider] = time.monotonic() + NOTICE_SECONDS


def outreach(item):
    key, ongoing = item.get('operationId'), item.get('active')
    if (not isinstance(key,str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',key)
            or type(ongoing) is not bool):
        raise ValueError('Nieprawidłowy stan operacji Outreach.')
    with _lock:
        if ongoing:
            _outreach[key] = time.monotonic() + OUTREACH_LEASE_SECONDS
        else:
            _outreach.pop(key,None)


def note_outreach_usage(item):
    now = time.time()
    if any(now - NOTICE_SECONDS <= request['created'] <= now for request in item['requests']):
        with _lock:
            _recent['OpenAI'] = time.monotonic() + NOTICE_SECONDS


def providers():
    now = time.monotonic()
    with _lock:
        expired = [key for key, until in _outreach.items() if until <= now]
        for key in expired:
            del _outreach[key]
        names = {provider for provider,count in _running.items() if count}
        names.update(provider for provider,until in _recent.items() if until > now)
        if _outreach:
            names.add('OpenAI')
        return sorted(names)
