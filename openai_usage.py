"""Local OpenAI request usage and estimated list-price costs."""
from contextlib import closing, contextmanager
from contextvars import ContextVar
from decimal import Decimal
import logging
import math
import re
import sqlite3
import time
from uuid import uuid4


# Standard short-context USD per 1M tokens. Verified against the OpenAI API
# pricing and model pages on 2026-11-20. Cache writes use the default retention.
STANDARD_RATES = {
    'gpt-6-luna': ('0.10', '0.01', '0.125', '0.50'),
    'gpt-6.1-terra': ('1', '0.05', '1.25', '5'),
    'gpt-6.1-sol': ('2', '0.10', '2.50', '10'),
    'gpt-6.2-sol': ('2', '0.10', '2.50', '10'),
    'gpt-6.2-astra': ('8', '0.40', '10', '40'),
    'gpt-6-astra': ('10', '1', '12.50', '50'),
    'gpt-4.1-mini': ('0.40', '0.10', None, '1.60'),
    'gpt-5.2': ('1.75', '0.175', None, '14'),
}
WEB_SEARCH_USD = Decimal('0.01')
SHORT_CONTEXT_INPUT_LIMIT = 272_000
NANOS_PER_DOLLAR = 1_000_000_000
REPORT_PAGE_SIZE = 250
OUTREACH_ACTIONS = frozenset(('generate','refine','article','translate'))

_operation = ContextVar('openai_usage_operation', default=None)
_database = None


@contextmanager
def _connect(path):
    with closing(sqlite3.connect(path,timeout=3)) as connection, connection:
        connection.row_factory = sqlite3.Row
        yield connection


def configure(path):
    global _database
    # Keep usage writes independent of transactions in the application database.
    with _connect(path) as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript("""
            CREATE TABLE IF NOT EXISTS openai_requests(
                id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, project_id INTEGER,
                action TEXT NOT NULL, reference TEXT, model TEXT NOT NULL, created REAL NOT NULL,
                duration_ms INTEGER, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                web_calls INTEGER NOT NULL, cost_nanos INTEGER);
            CREATE INDEX IF NOT EXISTS openai_requests_project_time ON openai_requests(project_id,created,id);
            CREATE TABLE IF NOT EXISTS openai_operations(
                id TEXT PRIMARY KEY, action TEXT NOT NULL, reference TEXT, last_request INTEGER NOT NULL,
                calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                web_calls INTEGER NOT NULL, cost_nanos INTEGER);
            CREATE INDEX IF NOT EXISTS openai_operations_latest ON openai_operations(last_request);
        """)
        if 'source_id' not in {column[1] for column in c.execute('PRAGMA table_info(openai_requests)')}:
            c.execute('ALTER TABLE openai_requests ADD COLUMN source_id TEXT')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS openai_requests_source ON openai_requests(source_id) WHERE source_id IS NOT NULL')
    _database = path


@contextmanager
def operation(action, reference=None, project_id=None, *, key=None):
    if key is None:
        key = f'{project_id}:{action}:{reference}' if reference is not None else uuid4().hex
    token = _operation.set((key, action, reference, project_id))
    try:
        yield
    finally:
        _operation.reset(token)


def run(action, reference, project_id, callback, *args):
    with operation(action, reference, project_id):
        return callback(*args)


def estimate_usd(model, tier, input_tokens, cached, cache_writes, output_tokens, web_calls):
    model = re.sub(r'-\d{4}-\d{2}-\d{2}$','',model)
    rates = STANDARD_RATES.get(model)
    if (not rates or tier not in (None, 'default', 'standard')
            or input_tokens > SHORT_CONTEXT_INPUT_LIMIT or cached + cache_writes > input_tokens):
        return None
    if (cache_writes and rates[2] is None) or (web_calls and model == 'gpt-4.1-mini'):
        return None
    regular_rate, cached_rate, write_rate, output_rate = (Decimal(rate or 0) for rate in rates)
    regular = input_tokens - cached - cache_writes
    return ((regular * regular_rate + cached * cached_rate + cache_writes * write_rate + output_tokens * output_rate)
            / 1_000_000 + web_calls * WEB_SEARCH_USD)


def record(response, requested_model, duration_ms=None, *, source_id=None, created=None, web_calls=None):
    path = _database
    if path is None:
        return
    usage = response.get('usage')
    if not isinstance(usage,dict):
        return
    input_tokens, output_tokens = usage.get('input_tokens'),usage.get('output_tokens')
    if any(type(value) is not int or value < 0 for value in (input_tokens,output_tokens)):
        return
    details = usage.get('input_tokens_details')
    details = details if isinstance(details,dict) else {}
    cached, cache_writes = details.get('cached_tokens') or 0,details.get('cache_write_tokens') or 0
    output_items = response.get('output')
    if web_calls is None:
        web_calls = sum(isinstance(item,dict) and item.get('type')=='web_search_call'
                        for item in output_items) if isinstance(output_items,list) else 0
    model = response.get('model')
    model = model if isinstance(model,str) and model else requested_model
    cost = None
    if all(type(value) is int and value >= 0 for value in (cached,cache_writes)):
        cost = estimate_usd(model,response.get('service_tier'),input_tokens,cached,cache_writes,output_tokens,web_calls)
    scope = _operation.get()
    key, action, reference, project_id = scope if scope is not None else (uuid4().hex,'openai',None,None)
    nanos = None if cost is None else int(cost * NANOS_PER_DOLLAR)
    try:
        with _connect(path) as c:
            cursor = c.execute("""INSERT OR IGNORE INTO openai_requests(operation_id,project_id,action,reference,model,
                created,duration_ms,input_tokens,output_tokens,web_calls,cost_nanos,source_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (key,project_id,action,reference,model,time.time() if created is None else created,
                 duration_ms,input_tokens,output_tokens,web_calls,nanos,source_id))
            if not cursor.rowcount:
                return
            request_id = cursor.lastrowid
            c.execute("""INSERT INTO openai_operations VALUES(?,?,?,?,1,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET last_request=excluded.last_request,calls=calls+1,
                input_tokens=openai_operations.input_tokens+excluded.input_tokens,
                output_tokens=openai_operations.output_tokens+excluded.output_tokens,
                web_calls=openai_operations.web_calls+excluded.web_calls,
                cost_nanos=openai_operations.cost_nanos+excluded.cost_nanos""",
                (key,action,reference,request_id,input_tokens,output_tokens,web_calls,nanos))
    except sqlite3.Error:
        if source_id is not None:
            raise
        logging.exception('Nie udało się zapisać zużycia OpenAI.')


def record_outreach(item, project_id):
    action, key, requests = item.get('action'), item.get('operationId'), item.get('requests')
    if (not isinstance(action,str) or action not in OUTREACH_ACTIONS or
            not isinstance(key,str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',key) or
            not isinstance(requests,list) or not 1 <= len(requests) <= 20):
        raise ValueError('Nieprawidłowe dane kosztów rozszerzenia.')
    numeric_fields = ('inputTokens','outputTokens','cachedTokens','cacheWriteTokens','webCalls','durationMs','created')
    now = time.time()
    for request in requests:
        if (not isinstance(request,dict) or any(
                not isinstance(request.get(field),str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,160}',request[field])
                for field in ('id','model')) or
                any(type(request.get(field)) is not int or not 0 <= request[field] <= 2**53-1 for field in numeric_fields)
                or request['outputTokens'] > 2**31-1 or request['webCalls'] > 2**31-1
                or not 0 < request['created'] <= now + 300):
            raise ValueError('Nieprawidłowe dane zapytania OpenAI.')
    with operation('extension/'+action,project_id=project_id,key='extension:'+key):
        for request in requests:
            record({'model':request['model'],'service_tier':request.get('serviceTier'),'usage':{
                'input_tokens':request['inputTokens'],'output_tokens':request['outputTokens'],
                'input_tokens_details':{'cached_tokens':request['cachedTokens'],
                                        'cache_write_tokens':request['cacheWriteTokens']}}},
                request['model'],request['durationMs'],source_id='extension:'+request['id'],
                created=request['created'],web_calls=request['webCalls'])


def _with_cost(row):
    row = dict(row)
    nanos = row.pop('cost_nanos')
    row['cost_usd'] = None if nanos is None else str(Decimal(nanos)/NANOS_PER_DOLLAR)
    return row


def recent(limit=12):
    path = _database
    if path is None:
        return []
    with _connect(path) as c:
        return [_with_cost(row) for row in c.execute("""SELECT action,reference,calls,input_tokens,output_tokens,
            web_calls,cost_nanos FROM openai_operations ORDER BY last_request DESC LIMIT ?""",(limit,))]


def report(project_id, start, end, page=1):
    page = int(page)
    if page < 1:
        raise ValueError('Nieprawidłowa strona zapytań OpenAI.')
    path = _database
    totals = {'calls':0,'input_tokens':0,'output_tokens':0,'unpriced':0,'cost_usd':'0'}
    requests = []
    pages = 1
    if path is not None:
        args = (project_id,start,end)
        with _connect(path) as c:
            c.execute('BEGIN')
            totals = _with_cost(c.execute("""SELECT COUNT(*) AS calls,COALESCE(SUM(input_tokens),0) AS input_tokens,
                COALESCE(SUM(output_tokens),0) AS output_tokens,COUNT(*)-COUNT(cost_nanos) AS unpriced,
                COALESCE(SUM(cost_nanos),0) AS cost_nanos FROM openai_requests
                WHERE project_id=? AND created BETWEEN ? AND ?""",args).fetchone())
            pages = max(1,math.ceil(totals['calls']/REPORT_PAGE_SIZE))
            page = min(page,pages)
            requests = [_with_cost(row) for row in c.execute("""SELECT id,action,reference,model,created,duration_ms,
                input_tokens,output_tokens,web_calls,cost_nanos FROM openai_requests
                WHERE project_id=? AND created BETWEEN ? AND ? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?""",
                (*args,REPORT_PAGE_SIZE,(page-1)*REPORT_PAGE_SIZE))]
    return {'totals':totals,'requests':requests,'page':min(page,pages),'pages':pages}
