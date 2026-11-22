"""Local rotating diagnostics without logging exception messages or secrets."""
from collections import Counter, deque
from contextlib import contextmanager
from datetime import datetime
from itertools import count
import logging
import re
from logging.handlers import RotatingFileHandler
from threading import Lock
import traceback


LOG = logging.getLogger('kaska')
LOG_FILENAME = 'katie.log'
LOG_BACKUPS = 3
LOG_ENTRY = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}) (INFO|WARNING|ERROR|CRITICAL) \S+ (.+)$')
MAX_LOG_ENTRIES = 200
ACTIVE = {}
ACTIVE_LOCK = Lock()
ACTIVE_IDS = count(1)
LEAD_ACTIVITY = {
    'discover': 'Wyszukiwanie firm',
    'research': 'Analiza stron firm',
    'evaluate': 'Kwalifikacja firm',
    'signals': 'Sprawdzanie sygnałów sprzedażowych',
}
RUN_HISTORY = (
    """SELECT r.updated AS created,COALESCE(NULLIF(r.stage,''),'Wyszukiwanie i weryfikacja kontaktów') AS detail,
         CASE WHEN r.status='error' THEN 'error' ELSE 'info' END AS level,p.name AS project_name,r.status
       FROM prospect_runs r JOIN seller_projects p ON p.id=r.project_id
       WHERE r.status IN ('ready','error','interrupted')""",
    """SELECT r.updated AS created,COALESCE(NULLIF(r.stage,''),'Wyszukiwanie okazji') AS detail,
         CASE WHEN r.status IN ('error','partial') THEN 'error' ELSE 'info' END AS level,p.name AS project_name,r.status
       FROM opportunity_searches r JOIN seller_projects p ON p.id=r.project_id
       WHERE r.status IN ('completed','partial','error','cancelled','interrupted','stale')""",
)


@contextmanager
def working(label, scope=None, project_name=None):
    with ACTIVE_LOCK:
        key = next(ACTIVE_IDS)
        ACTIVE[key] = (scope, {'label': label, 'project_name': project_name, 'status': 'running'})
    try:
        yield
    finally:
        with ACTIVE_LOCK:
            ACTIVE.pop(key)


def active(connection, scope):
    jobs = [dict(row) | {'label': LEAD_ACTIVITY[row['kind']]} for row in connection.execute("""
        SELECT j.kind,j.status,p.name AS project_name
        FROM lead_search_jobs j JOIN seller_projects p ON p.id=j.project_id
        WHERE p.deleted=0 AND j.status='running' AND j.lease>unixepoch()
          AND j.kind IN ('discover','research','evaluate','signals')
        ORDER BY j.id
    """)]
    with ACTIVE_LOCK:
        jobs.extend(job for generation, job in ACTIVE.values() if generation == scope)
    return jobs


def workspace_history(connection, level):
    queries = (
        """SELECT created,detail,'info' AS level,NULL AS project_name,NULL AS status
           FROM events WHERE created IS NOT NULL""",
        *RUN_HISTORY,
        """SELECT e.created,e.label AS detail,'info' AS level,p.name AS project_name,'completed' AS status
           FROM lead_search_events e JOIN lead_searches s ON s.id=e.search_id
           JOIN seller_projects p ON p.id=s.project_id""",
        """SELECT m.sent_at AS created,'Wysłano wiadomość e-mail' AS detail,'info' AS level,
             p.name AS project_name,'completed' AS status
           FROM messages m JOIN campaigns c ON c.id=m.campaign_id JOIN seller_projects p ON p.id=c.project_id
           WHERE m.status='sent' AND m.sent_at IS NOT NULL AND c.channel='email'""",
    )
    return [dict(row) for query in queries for row in connection.execute(
        f'SELECT * FROM ({query}) WHERE (? = \'all\' OR level = ?) ORDER BY created DESC LIMIT ?',
        (level, level, MAX_LOG_ENTRIES),
    )]


def configure(directory):
    LOG.setLevel(logging.INFO)
    if LOG.handlers:
        return
    handler = RotatingFileHandler(directory / LOG_FILENAME, maxBytes=2_000_000,
                                  backupCount=LOG_BACKUPS, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(threadName)s %(message)s'))
    LOG.addHandler(handler)
    LOG.propagate = False


def log_error(context, exc):
    # Exception text can contain credentials, URLs, or submitted user data.
    LOG.error('%s (%s)\n%s', context, type(exc).__name__, ''.join(traceback.format_tb(exc.__traceback__)))


def recent(directory, connection, level):
    if level not in ('all', 'info', 'error'):
        raise ValueError('Wybierz poprawny poziom logów.')
    entries = workspace_history(connection, level)
    if level != 'info':
        for suffix in ('', *(f'.{number}' for number in range(1, LOG_BACKUPS + 1))):
            errors = deque(log_errors(directory / (LOG_FILENAME + suffix)), maxlen=MAX_LOG_ENTRIES)
            entries.extend(reversed(errors))
    return sorted(entries, key=lambda row: row['created'], reverse=True)[:MAX_LOG_ENTRIES]


def log_errors(path):
    try:
        with path.open(encoding='utf-8', errors='replace') as stream:
            for line in stream:
                match = LOG_ENTRY.match(line)
                if match is None or match[2] not in ('ERROR', 'CRITICAL'):
                    continue
                try:
                    created = datetime.strptime(match[1], '%Y-%m-%d %H:%M:%S,%f').timestamp()
                except ValueError:
                    continue
                yield {'created': created, 'level': 'error', 'detail': match[3][:2000]}
    except FileNotFoundError:
        pass


def error_report(directory, connection, start, end):
    counts = Counter()

    def record(timestamp):
        if start <= timestamp <= end:
            counts[int(timestamp // 3600) * 3600] += 1

    for suffix in ('', *(f'.{number}' for number in range(1, LOG_BACKUPS + 1))):
        for row in log_errors(directory / (LOG_FILENAME + suffix)):
            record(row['created'])
    for query in RUN_HISTORY:
        for row in connection.execute(f"SELECT created FROM ({query}) WHERE level='error' AND created BETWEEN ? AND ?",
                                      (start, end)):
            record(row['created'])
    return sorted(counts.items())
