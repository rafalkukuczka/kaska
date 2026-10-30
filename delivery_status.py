"""Read-only explanations of the outbound worker's eligibility checks."""
import os
import time
from datetime import datetime, timezone

import sequence_conditions


def annotate(c, campaign, messages, now=None):
    now = time.time() if now is None else now
    history = [dict(row) for row in c.execute(
        'SELECT * FROM messages WHERE campaign_id=?', (campaign['id'],))]
    by_person = {}
    for row in history:
        by_person.setdefault(row['contact_id'], []).append(row)
    contacts = {row['id']: dict(row) for row in c.execute(
        'SELECT t.* FROM contacts t WHERE t.id IN (SELECT contact_id FROM messages WHERE campaign_id=?)',
        (campaign['id'],))}
    steps = {row['position']: row['delay_days'] for row in c.execute(
        'SELECT position,delay_days FROM steps WHERE campaign_id=?', (campaign['id'],))}
    midnight = datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    sent = c.execute('SELECT COUNT(*) FROM messages WHERE sent_at>=?', (midnight,)).fetchone()[0]
    last = c.execute('SELECT MAX(sent_at) FROM messages').fetchone()[0] or 0
    limit = int(os.getenv('DAILY_SEND_LIMIT', '50'))
    interval = int(os.getenv('SEND_INTERVAL_SECONDS', '60'))
    simulation = c.execute("SELECT value FROM app_preferences WHERE key='data_simulation'").fetchone()
    smtp = bool(os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM'))
    counts = {}
    next_times = []
    for message in messages:
        code = message['status']
        earliest = None
        if code == 'queued':
            person = contacts.get(message['contact_id'])
            previous = [row for row in by_person.get(message['contact_id'], []) if row['position'] < message['position']]
            if campaign['status'] != 'active':
                code = 'paused' if campaign['status'] == 'paused' else 'not_started'
            elif simulation and simulation['value'] == 'on':
                code = 'simulation'
            elif not smtp:
                code = 'smtp_missing'
            elif not person or person['status'] != 'active':
                code = 'contact_inactive'
            elif person['simulated']:
                code = 'simulated_contact'
            elif not sequence_conditions.matches(campaign['conditions'], person, 0):
                code = 'condition'
            elif any(row['status'] != 'sent' for row in previous):
                code = 'previous_step'
            elif not sequence_conditions.matches(campaign['conditions'], person, message['position'], message['position']-1):
                code = 'condition'
            else:
                earliest = message['due']
                predecessor = next((row for row in previous if row['position'] == message['position']-1), None)
                if message['position'] and (not predecessor or predecessor['sent_at'] is None or message['position'] not in steps or predecessor['position'] not in steps):
                    code = 'previous_step'
                    earliest = None
                else:
                    if predecessor:
                        earliest = max(earliest, predecessor['sent_at'] + (steps[message['position']]-steps[predecessor['position']])*86400)
                    earliest = max(earliest, last+interval)
                    if sent >= limit:
                        earliest = max(earliest, midnight+86400)
                        code = 'daily_limit'
                    elif last+interval > now:
                        earliest = max(earliest, last+interval)
                        code = 'interval'
                    elif earliest > now:
                        code = 'scheduled'
                    else:
                        code = 'ready'
                    if limit <= 0:
                        earliest = None
                    elif earliest is not None:
                        next_times.append(max(now, earliest))
        message['delivery_reason'] = code
        message['next_attempt_at'] = earliest
        if message['status'] == 'queued':
            counts[code] = counts.get(code, 0)+1
    return {'reasons': counts, 'next_attempt_at': min(next_times) if next_times else None,
            'daily_limit': limit, 'sent_today': sent, 'interval_seconds': interval}
