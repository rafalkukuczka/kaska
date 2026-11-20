"""Shared public evidence and structured company research sources."""
import json
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as xml
from datetime import date, datetime, timedelta, timezone
from html import unescape
from urllib.parse import urljoin, urlsplit

import opportunity_discovery as publications
import public_data
from content_library import Page


SOURCE_TTL = 3600
REGISTER_PORTAL = 'https://www.handelsregister.de/rp_web/welcome.xhtml'
TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search'
TECH = {
    'PLC / OT': r'\b(?:plc|sps|scada|opc\s*ua|tia portal|siemens s7|automatisierungstechnik)\b',
    'ERP / MES': r'\b(?:erp|mes|sap\s*s/4hana|sap\s*ecc|manufacturing execution system)\b',
    '.NET / Java': r'(?:\bc#(?!\w)|\.net\b|\bjava\b|\bsql server\b)',
}
REGISTER = re.compile(r'\b(?:Amtsgericht|Registergericht|Handelsregister)\b.{0,150}?\b(HR[AB]\s*\d{2,12})\b', re.I)


def init_schema(c):
    c.executescript("""
      CREATE TABLE IF NOT EXISTS lead_source_cache(
        project_id INTEGER NOT NULL REFERENCES seller_projects(id), url TEXT NOT NULL,
        final_url TEXT NOT NULL, body TEXT NOT NULL, fetched REAL NOT NULL, PRIMARY KEY(project_id,url));
      CREATE TABLE IF NOT EXISTS lead_company_profiles(
        project_id INTEGER NOT NULL REFERENCES seller_projects(id), domain TEXT NOT NULL,
        profile TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY(project_id,domain));
      CREATE TABLE IF NOT EXISTS lead_private_evidence(
        project_id INTEGER NOT NULL REFERENCES seller_projects(id), domain TEXT NOT NULL,
        kind TEXT NOT NULL, observed_date TEXT NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY(project_id,domain,kind,observed_date,detail));
    """)
    c.execute('DELETE FROM lead_source_cache WHERE fetched<?', (time.time()-7*SOURCE_TTL,))


class SourceCache:
    def __init__(self, db):
        self.db = db
        self.locks = [threading.Lock() for _ in range(64)]

    def fetch(self, project, url):
        url = public_data.public_url(url).geturl()
        with self.locks[hash((project,url)) % len(self.locks)]:
            with self.db() as c:
                row = c.execute('SELECT body,final_url FROM lead_source_cache WHERE project_id=? AND url=? AND fetched>=?',
                                (project,url,time.time()-SOURCE_TTL)).fetchone()
            if row:
                return row['body'],row['final_url']
            body, final = public_data.fetch_public(url)
            with self.db() as c:
                c.executemany("""INSERT INTO lead_source_cache VALUES(?,?,?,?,?)
                    ON CONFLICT(project_id,url) DO UPDATE SET final_url=excluded.final_url,body=excluded.body,fetched=excluded.fetched""",
                              [(project,key,final,body,time.time()) for key in dict.fromkeys((url,final))])
            return body,final

    def publication(self, project, url, local_cache):
        return publications.read_publication(url,local_cache,fetch=lambda address:self.fetch(project,address))


def _page_text(markup):
    page = Page()
    page.feed(unescape(markup))
    return ' '.join(page.parts)


def ats_endpoint(address):
    p = urlsplit(address)
    host = p.hostname or ''
    if p.scheme != 'https' or p.username or p.password or p.port not in (None,443):
        return None
    if re.fullmatch(r'[a-z0-9-]+(?:\.jobs\.|-jobs\.)personio\.(?:de|com)',host):
        return 'Personio', f'https://{host}/xml'
    if host in ('boards.greenhouse.io','job-boards.greenhouse.io','job-boards.eu.greenhouse.io'):
        board = p.path.strip('/').split('/')[0]
        if re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',board) and board != 'embed':
            api = 'boards-api.eu.greenhouse.io' if host == 'job-boards.eu.greenhouse.io' else 'boards-api.greenhouse.io'
            return 'Greenhouse', f'https://{api}/v1/boards/{board}/jobs?content=true'
    return None


def discover_ats_links(html, url):
    page = Page()
    page.feed(html)
    matches = {}
    for href, _ in page.links[:400]:
        try:
            endpoint = ats_endpoint(urljoin(url,href))
        except ValueError:
            continue
        if endpoint:
            matches[endpoint] = None
    return list(matches)[:2]


def _date(value):
    try:
        text = str(value)
        if re.fullmatch(r'\d{8}',text):
            return datetime.strptime(text,'%Y%m%d').date().isoformat()
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return ''


def _job(title, detail, url, provider, published='', updated=''):
    title, detail = ' '.join(title.split())[:220], ' '.join(detail.split())[:2400]
    if not title:
        return None
    return {'title':title,'text':detail,'url':url,'provider':provider,'published':_date(published),'updated':_date(updated),
            'technology':[label for label, pattern in TECH.items() if re.search(pattern,title+' '+detail,re.I)]}


def job_posts(provider, endpoint, fetch):
    body, final = fetch(endpoint)
    if urlsplit(final).hostname != urlsplit(endpoint).hostname:
        raise ValueError('Kanał ofert zmienił domenę.')
    items = []
    if provider == 'Personio':
        if re.search(r'<!\s*(?:DOCTYPE|ENTITY)',body,re.I):
            raise ValueError('Niedozwolony typ dokumentu XML.')
        for row in xml.fromstring(body).findall('position')[:120]:
            key = row.findtext('id','')
            if not key.isdigit():
                continue
            url = final.split('/xml',1)[0] + '/job/' + key
            detail = ' '.join(item.text or '' for item in row.findall('jobDescriptions/jobDescription/value'))
            items.append(_job(row.findtext('name',''),_page_text(detail),url,provider,row.findtext('createdAt','')))
    else:
        payload = json.loads(body)
        for row in payload.get('jobs',[])[:120]:
            if not isinstance(row,dict) or not row.get('internal_job_id') or not isinstance(row.get('title'),str):
                continue
            try:
                url = public_data.public_url(row.get('absolute_url')).geturl()
            except ValueError:
                continue
            items.append(_job(row['title'],_page_text(str(row.get('content') or '')),url,provider,
                              row.get('first_published'),row.get('updated_at')))
    return [item for item in items if item]


def company_profile(pages, fetch):
    endpoints = dict.fromkeys(tuple(endpoint) for page in pages for endpoint in page.get('ats', []))
    jobs = {}
    for provider, url in list(endpoints)[:3]:
        try:
            for job in job_posts(provider,url,fetch):
                jobs.setdefault(job['url'],job)
        except (ValueError,OSError,xml.ParseError,TypeError,AttributeError):
            continue
    identity = None
    for page in pages:
        if page.get('official') and re.search(r'impressum|imprint|legal[-_/]notice',urlsplit(page['url']).path,re.I):
            match = REGISTER.search(page['text'])
            if match:
                identity = {'number':match.group(1),'quote':match.group(0),'url':page['url'],'register_url':REGISTER_PORTAL}
                break
    ranked = sorted(jobs.values(),key=lambda item:(bool(item['technology']),item['published'],item['updated']),reverse=True)
    return {'identity':identity,'jobs':ranked[:20],'active_jobs':len(jobs)}


def job_signals(profile, kind):
    if kind not in ('hiring','it_hiring'):
        return []
    now = datetime.now(timezone.utc)
    rules = r'\b(?:software|developer|entwickler|automation|automatisierung|informatik|\bit\b)'
    matches = []
    for job in profile.get('jobs',[]):
        if kind == 'it_hiring' and not (job['technology'] or re.search(rules,job['title'],re.I)):
            continue
        matches.append({'kind':kind,'title':'Aktywna oferta · '+job['title'],'url':job['url'],
                        'quote':job['title'],'source_date':now.date().isoformat(),'date_kind':'active','observed':now.timestamp()})
    return matches[:3]


def _strings(value):
    if isinstance(value,str):
        yield value
    elif isinstance(value,dict):
        for key in sorted(value,key=lambda k: k not in ('deu','eng')):
            yield from _strings(value[key])
    elif isinstance(value,list):
        for item in value:
            yield from _strings(item)


def ted_notices(names):
    allowed = [name for name in names if isinstance(name,str) and 4 <= len(name) <= 160]
    if not allowed:
        return []
    today = datetime.now(timezone.utc).date()
    cutoff = (today-timedelta(days=30)).strftime('%Y%m%d')
    name = re.sub(r'["\\\x00-\x1f]',' ',allowed[0])
    query = f'buyer-name ~ "{name}" AND publication-date >= {cutoff} AND notice-type IN (cn-standard cn-social)'
    fields = ['buyer-name','publication-number','notice-title','publication-date','notice-type']
    req = urllib.request.Request(TED_SEARCH,json.dumps({'query':query,'fields':fields,'limit':20,'page':1,
                                 'scope':'ACTIVE','paginationMode':'PAGE_NUMBER'}).encode(),
                                 headers={'Content-Type':'application/json','Accept':'application/json'},method='POST')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req,timeout=15) as response:
        raw = response.read(1_000_001)
    if len(raw)>1_000_000:
        raise ValueError('Odpowiedź TED jest zbyt duża.')
    return parse_ted(json.loads(raw),allowed,today)


def parse_ted(body, names, today):
    normalized = {public_data.norm(name).strip() for name in names}
    matches = []
    for row in body.get('notices',[])[:20]:
        if not isinstance(row,dict):
            continue
        purchaser = next((name for name in _strings(row.get('buyer-name')) if public_data.norm(name).strip() in normalized),'')
        number = row.get('publication-number','')
        day = _date(next(_strings(row.get('publication-date')),row.get('publication-date')))
        title = next(_strings(row.get('notice-title')),'')
        if not (purchaser and title and isinstance(number,str) and re.fullmatch(r'\d{1,10}-\d{4}',number)
                and set(_strings(row.get('notice-type'))) & {'cn-standard','cn-social'}
                and day and (today-timedelta(days=30)).isoformat() <= day <= today.isoformat()):
            continue
        matches.append({'kind':'tender','title':title[:220],'url':f'https://ted.europa.eu/en/notice/-/detail/{number}',
                        'quote':purchaser+' · '+title[:700],'source_date':day,'date_kind':'publication','observed':time.time()})
    return matches[:4]


def contact_roles(profile, signal_kinds):
    tech = {area for job in profile.get('jobs',[])[:5] for area in job['technology']}
    if 'PLC / OT' in tech:
        return 'Leiter Automatisierung, Head of Automation, OT Manager'
    if {'erp','integration'} & set(signal_kinds) or 'ERP / MES' in tech:
        return 'IT-Leiter, ERP-Projektleiter, Head of IT, MES Manager'
    if '.NET / Java' in tech or 'it_hiring' in signal_kinds:
        return 'CTO, Head of Engineering, Head of Software Development'
    return ''
