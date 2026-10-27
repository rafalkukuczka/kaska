import project_scope
"""Evidence-backed sales signals. Standard library only; no vendor data is bundled."""
import hashlib
import http.client
import ipaddress
import json
import contact_tags
import re
import socket
import ssl
import threading
import time
import unicodedata
import xml.etree.ElementTree as ET
import sequence_conditions
import languages
from contextlib import nullcontext
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlparse, urljoin


# These are detection rules, not 50 purchased data-source integrations.
DEFINITIONS = [
 ('funding','Nowe finansowanie','Kapitał',80,'raised funding|secured funding|funding round|runda finansowania|pozyskali finansowanie|pozyskala finansowanie'),
 ('seed','Runda seed','Kapitał',75,'seed round|pre-seed|runda seed'),
 ('series_a','Runda Series A','Kapitał',85,'series a|seria a'),
 ('series_b','Runda Series B+','Kapitał',90,'series b|series c|series d'),
 ('ipo','Debiut giełdowy','Kapitał',85,'initial public offering|files for ipo|debiut gieldowy'),
 ('grant','Dotacja','Kapitał',65,'awarded a grant|received a grant|otrzymala dotacje|dofinansowanie unijne'),
 ('acquisition','Przejęcie firmy','Kapitał',85,'acquires|acquired by|przejmuje firme|przejecie spolki'),
 ('merger','Fuzja','Kapitał',80,'merges with|merger agreement|fuzja z|polaczenie spolek'),
 ('investment','Inwestycja kapitałowa','Kapitał',70,'strategic investment|capital investment|inwestycja kapitalowa'),
 ('revenue','Wzrost przychodów','Wzrost',70,'revenue growth|record revenue|wzrost przychodow|rekordowe przychody'),
 ('hiring','Rekrutacja','Zespół',60,'we are hiring|we\'re hiring|join our team|rekrutujemy|dolacz do zespolu'),
 ('sales_hiring','Rekrutacja sprzedaży','Zespół',75,'hiring sdr|hiring account executive|sales development representative|szukamy handlowca'),
 ('it_hiring','Rekrutacja IT','Zespół',65,'hiring engineers|hiring developers|szukamy programisty|rekrutacja programistow'),
 ('marketing_hiring','Rekrutacja marketingu','Zespół',65,'hiring marketing|marketing manager wanted|szukamy marketera'),
 ('leadership_hiring','Rekrutacja kadry zarządzającej','Zespół',70,'hiring a vp|seeking a ceo|szukamy dyrektora'),
 ('new_ceo','Nowy CEO','Zespół',85,'appointed ceo|new ceo|nowy prezes|nowa prezes'),
 ('new_cfo','Nowy CFO','Zespół',80,'appointed cfo|new cfo|nowy dyrektor finansowy'),
 ('new_cto','Nowy CTO','Zespół',85,'appointed cto|new cto|nowy dyrektor technologiczny'),
 ('new_cro','Nowy lider sprzedaży','Zespół',85,'new cro|chief revenue officer|nowy dyrektor sprzedazy'),
 ('new_cmo','Nowy CMO','Zespół',80,'new cmo|chief marketing officer|nowy dyrektor marketingu'),
 ('layoffs','Redukcja zatrudnienia','Zespół',45,'layoffs|reduces workforce|zwolnienia grupowe|redukcja zatrudnienia'),
 ('team_growth','Wzrost zespołu','Zespół',70,'doubled our team|headcount growth|powiekszamy zespol|podwoila zatrudnienie'),
 ('new_market','Wejście na nowy rynek','Ekspansja',80,'enters the market|entering a new market|wchodzi na rynek|ekspansja zagraniczna'),
 ('new_office','Nowe biuro','Ekspansja',70,'opens new office|new headquarters|otwiera nowe biuro|nowa siedziba'),
 ('new_factory','Nowy zakład','Ekspansja',75,'new factory|new manufacturing facility|nowa fabryka|nowy zaklad produkcyjny'),
 ('new_store','Nowy punkt sprzedaży','Ekspansja',60,'opens a new store|new retail location|otwiera nowy sklep'),
 ('international','Ekspansja międzynarodowa','Ekspansja',80,'international expansion|expands globally|ekspansja miedzynarodowa'),
 ('partnership','Nowe partnerstwo','Wzrost',65,'strategic partnership|partners with|partnerstwo strategiczne|nawiazuje wspolprace'),
 ('new_client','Nowy duży klient','Wzrost',65,'wins a contract|new enterprise customer|pozyskala klienta|nowy kontrakt'),
 ('award','Nagroda branżowa','Wzrost',45,'wins award|industry award|nagroda branzowa|otrzymala nagrode'),
 ('product_launch','Premiera produktu','Produkt',75,'launches new product|product launch|premiera produktu|wprowadza nowy produkt'),
 ('service_launch','Nowa usługa','Produkt',70,'launches new service|introduces a service|wprowadza nowa usluge'),
 ('pricing_change','Zmiana cennika','Produkt',60,'pricing update|new pricing|zmiana cennika|nowy cennik'),
 ('rebrand','Rebranding','Produkt',65,'rebrands|rebranding|zmienia nazwe|nowa identyfikacja wizualna'),
 ('website_launch','Nowa strona internetowa','Technologia',55,'new website|website launch|nowa strona internetowa|uruchomilismy nowa strone'),
 ('app_launch','Premiera aplikacji','Produkt',70,'launches app|mobile app launch|premiera aplikacji|nowa aplikacja mobilna'),
 ('api_launch','Udostępnienie API','Technologia',70,'launches api|public api|udostepnia api|nowe api'),
 ('integration','Nowa integracja','Technologia',65,'new integration|integrates with|nowa integracja|integracja z'),
 ('crm','Wdrożenie CRM','Technologia',85,'implements salesforce|adopts hubspot|wdrozenie crm|wdraza crm'),
 ('erp','Wdrożenie ERP','Technologia',85,'implements sap|erp implementation|wdrozenie erp|wdraza erp'),
 ('cloud','Migracja do chmury','Technologia',80,'cloud migration|migrates to aws|migracja do chmury'),
 ('ai_adoption','Wdrożenie AI','Technologia',80,'adopts ai|ai implementation|wdraza ai|wdrozenie sztucznej inteligencji'),
 ('cybersecurity','Inwestycja w bezpieczeństwo','Technologia',80,'security investment|cybersecurity initiative|inwestycja w cyberbezpieczenstwo'),
 ('certification','Nowa certyfikacja','Technologia',60,'iso 27001 certified|soc 2 certified|uzyskala certyfikat|certyfikacja iso'),
 ('tender','Przetarg / zapytanie ofertowe','Intencja',95,'request for proposal|request for quotation|oglasza przetarg|zapytanie ofertowe'),
 ('vendor_search','Poszukiwanie dostawcy','Intencja',95,'looking for a vendor|seeking a supplier|szukamy dostawcy|poszukuje wykonawcy'),
 ('event','Wydarzenie / konferencja','Aktywność',50,'hosting a conference|upcoming webinar|organizuje konferencje|zapraszamy na webinar'),
 ('demo_request','Prośba o demo','Aktywność',100,'requested a demo|demo request|prosba o demo|zamowil prezentacje'),
 ('pricing_visit','Wizyta na cenniku','Aktywność',85,'visited pricing|pricing page visit|wizyta na cenniku'),
 ('content_download','Pobranie materiału','Aktywność',60,'downloaded whitepaper|downloaded ebook|pobral raport|pobranie ebooka'),
 ('regulation','Zmiana przepisów','Rynek',75,'nowe przepisy|zmiana przepisow|wchodzi w zycie|new regulation|regulatory change'),
 ('market_trend','Trend rynkowy','Rynek',60,'raport branzowy|trend rynkowy|market trend|industry report'),
 ('market_news','Wiadomość dotycząca tematu','Rynek',50,'wiadomosc rynkowa|market news'),
]
CATALOG = {key: {'key':key, 'label':label, 'category':category, 'weight':weight, 'keywords':words.split('|')}
           for key,label,category,weight,words in DEFINITIONS}
SCAN_LOCK = threading.Lock()


def norm(value):
    text = unicodedata.normalize('NFKD', str(value).casefold().replace('ł','l'))
    return ''.join(c for c in text if not unicodedata.combining(c))


def has_phrase(text, phrase):
    return bool(re.search(r'(?<!\w)' + re.escape(norm(phrase)) + r'(?!\w)', norm(text)))


def public_url(url):
    p = urlparse(str(url))
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.port not in (None,443):
        raise ValueError('Wymagany publiczny adres HTTPS bez danych logowania')
    return p


class FetchError(ValueError):
    def __init__(self,status,retry_after=None):
        super().__init__('Źródło zwróciło HTTP '+str(status));self.status=status;self.retry_after=retry_after


def fetch_public(url,max_bytes=1_000_000):
    for _ in range(4):
        p = public_url(url)
        addresses = socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError('Źródło nie może prowadzić do adresu prywatnego')
        conn = http.client.HTTPSConnection(p.hostname,timeout=15,context=ssl.create_default_context())
        raw = socket.create_connection((addresses[0][4][0],443),timeout=15)
        try:
            conn.sock = conn._context.wrap_socket(raw,server_hostname=p.hostname)
            conn.request('GET',(p.path or '/') + ('?'+p.query if p.query else ''),headers={'User-Agent':'KatieSignals/1.0','Accept':'application/rss+xml, application/atom+xml, application/json, text/html'})
            response = conn.getresponse()
            if response.status in (301,302,303,307,308):
                url=urljoin(url,response.getheader('Location',''))
                continue
            if response.status != 200:
                retry=response.getheader('Retry-After')
                try:retry=float(retry) if retry else None
                except ValueError:
                    try:retry=max(0,parsedate_to_datetime(retry).timestamp()-time.time())
                    except (ValueError,TypeError):retry=None
                raise FetchError(response.status,retry)
            content=response.read(max_bytes+1)
            if len(content)>max_bytes:
                raise ValueError('Źródło przekracza limit '+str(max_bytes//1_000_000)+' MB')
            return content.decode('utf-8-sig',errors='replace'),url
        finally:
            conn.close()
    raise ValueError('Zbyt wiele przekierowań źródła')


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript'): self.skip+=1
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip and data.strip(): self.parts.append(data.strip())


def text(value):
    p=Text();p.feed(str(value));return ' '.join(p.parts)


def timestamp(value):
    if value in (None,''): return None
    try:
        if isinstance(value,(int,float)): result=float(value)
        else:
            try:
                parsed=datetime.fromisoformat(str(value).replace('Z','+00:00'))
                result=(parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
            except ValueError: result=parsedate_to_datetime(str(value)).timestamp()
        if not 0<result<=time.time()+86400: raise ValueError()
        return result
    except (ValueError,TypeError,OverflowError):
        raise ValueError('Nieprawidłowa data zdarzenia') from None


def init_schema(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS signal_sources(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,url TEXT NOT NULL,company TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,auto_accept INTEGER NOT NULL DEFAULT 0,interval_minutes INTEGER NOT NULL DEFAULT 60,last_checked REAL,last_success REAL,last_error TEXT,snapshot TEXT);
    CREATE TABLE IF NOT EXISTS sales_signals(id INTEGER PRIMARY KEY,source_id INTEGER REFERENCES signal_sources(id),company TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,evidence TEXT NOT NULL,url TEXT NOT NULL,occurred REAL,observed REAL NOT NULL,score INTEGER NOT NULL,explanation TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',fingerprint TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS signals_company ON sales_signals(company,status);
    CREATE TABLE IF NOT EXISTS signal_rules(id INTEGER PRIMARY KEY,campaign_id INTEGER NOT NULL UNIQUE REFERENCES campaigns(id),kinds TEXT NOT NULL,min_score INTEGER NOT NULL DEFAULT 60,max_age_days INTEGER NOT NULL DEFAULT 30,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS signal_enrollments(id INTEGER PRIMARY KEY,rule_id INTEGER NOT NULL REFERENCES signal_rules(id),campaign_id INTEGER NOT NULL REFERENCES campaigns(id),contact_id INTEGER NOT NULL REFERENCES contacts(id),signal_id INTEGER NOT NULL REFERENCES sales_signals(id),created REAL NOT NULL,UNIQUE(campaign_id,contact_id));
    ''')
    columns={r[1] for r in c.execute('PRAGMA table_info(signal_sources)')}
    if 'signal_kinds' not in columns:c.execute("ALTER TABLE signal_sources ADD COLUMN signal_kinds TEXT NOT NULL DEFAULT '[]'")
    for name,definition in [('deleted','INTEGER NOT NULL DEFAULT 0'),('config',"TEXT NOT NULL DEFAULT '{}'"),('next_retry','REAL'),('last_warning','TEXT'),('last_total','INTEGER'),('last_matched','INTEGER'),('last_created','INTEGER')]:
        if name not in columns:c.execute('ALTER TABLE signal_sources ADD COLUMN '+name+' '+definition)
    columns={r[1] for r in c.execute('PRAGMA table_info(sales_signals)')}
    for name,definition in [('source_date','REAL'),('source_date_kind',"TEXT NOT NULL DEFAULT ''"),('topic',"TEXT NOT NULL DEFAULT ''")]:
        if name not in columns:c.execute('ALTER TABLE sales_signals ADD COLUMN '+name+' '+definition)


class Engine:
    def __init__(self,db,ai_copy,mail_lock):
        self.db=db;self.ai_copy=ai_copy;self.mail_lock=mail_lock
        self.enroll_lock=threading.Lock()

    def state(self):
        from data_connectors import PROVIDERS
        with self.db() as c:
            return {'catalog':list(CATALOG.values()),'providers':list(PROVIDERS.values()),'sources':[dict(r) for r in c.execute('SELECT id,name,kind,url,company,enabled,auto_accept,signal_kinds,interval_minutes,last_checked,last_success,last_error,config,next_retry,last_warning,last_total,last_matched,last_created FROM signal_sources WHERE deleted=0 ORDER BY id DESC')],
                    'items':[dict(r) for r in c.execute('SELECT * FROM sales_signals ORDER BY observed DESC,id DESC LIMIT 2000')],
                    'rules':[dict(r) for r in c.execute('SELECT r.* FROM signal_rules r JOIN campaigns p ON p.id=r.campaign_id WHERE p.project_id=? ORDER BY r.id DESC',(project_scope.active(c),))],
                    'enrollments':[dict(r) for r in c.execute('SELECT e.* FROM signal_enrollments e JOIN campaigns p ON p.id=e.campaign_id WHERE p.project_id=? ORDER BY e.id DESC LIMIT 2000',(project_scope.active(c),))],
                    'counts':dict(c.execute("SELECT status,COUNT(*) FROM sales_signals GROUP BY status").fetchall())}

    def source_values(self,item):
        from data_connectors import PROVIDERS,configure
        kind=item['kind']
        if kind not in ('rss','page','json') and kind not in PROVIDERS: raise ValueError('Nieznany typ źródła')
        scope=item.get('scope','company')
        if scope not in ('company','market'):raise ValueError('Nieprawidłowy zakres źródła')
        company='' if scope=='market' else str(item.get('company','')).strip();config={}
        topic=str(item.get('topic','')).strip() if scope=='market' else ''
        if scope=='market' and not 2<=len(topic)<=150:raise ValueError('Podaj temat rynku od 2 do 150 znaków')
        if scope=='market' and kind in ('greenhouse','lever'):raise ValueError('Tablice pracy wymagają wskazania firmy')
        if kind in PROVIDERS:
            if not isinstance(item.get('config',{}),dict):raise ValueError('Nieprawidłowa konfiguracja integracji')
            provider_item=dict(item,company=company)
            if scope=='market':provider_item['config']={**item.get('config',{}),'search_term':topic}
            url,config=configure(provider_item)
            name=str(item.get('name') or PROVIDERS[kind]['name']+' · '+(company or topic)).strip()
        else:
            name=str(item['name']).strip();url=str(item['url']).strip()
        public_url(url)
        interval=int(item.get('interval_minutes',PROVIDERS[kind]['interval'] if kind in PROVIDERS else 60))
        if not name or (scope=='company' and not company) or not 5<=interval<=10080: raise ValueError('Podaj nazwę, firmę i interwał od 5 do 10080 minut')
        if scope=='market':config.update(scope='market',topic=topic)
        if len(company)>200 or len(url)>2000:raise ValueError('Nazwa firmy lub adres źródła są zbyt długie')
        kinds=item.get('signal_kinds',[])
        if not isinstance(kinds,list) or any(k not in CATALOG for k in kinds):raise ValueError('Nieprawidłowe typy sygnałów źródła')
        return (name[:200],kind,url,company,interval,int(bool(item.get('auto_accept',False))),json.dumps(config),json.dumps(list(dict.fromkeys(kinds))))

    def find_source(self,c,kind,url,company,deleted=0,topic=''):
        parsed=urlparse(url)
        alternate=url
        if parsed.path in ('','/') and not parsed.query and not parsed.fragment:alternate=url.rstrip('/') if parsed.path=='/' else url+'/'
        rows=c.execute('SELECT id,config FROM signal_sources WHERE deleted=? AND kind=? AND url IN (?,?) AND company_key(company)=company_key(?)',(deleted,kind,url,alternate,company)).fetchall()
        return next((row for row in rows if company or norm(json.loads(row['config']).get('topic',''))==norm(topic)),None)

    def save_source(self,c,values):
        name,kind,url,company,*_=values
        duplicate=self.find_source(c,kind,url,company,topic=json.loads(values[6]).get('topic',''))
        if duplicate:return duplicate['id'],False
        source_id=c.execute('INSERT INTO signal_sources(name,kind,url,company,interval_minutes,auto_accept,config,signal_kinds) VALUES(?,?,?,?,?,?,?,?)',values).lastrowid
        return source_id,True

    def source(self,item):
        values=self.source_values(item)
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            return self.save_source(c,values)[0]

    def delete_source(self,source_id):
        with self.db() as c:
            c.execute('PRAGMA busy_timeout=3000')
            changed=c.execute('UPDATE signal_sources SET deleted=1,enabled=0 WHERE id=? AND deleted=0',(source_id,)).rowcount
            if not changed:raise ValueError('Nie znaleziono źródła')

    def contact_companies(self):
        with self.db() as c:
            names=[r['company'].strip() for r in c.execute("SELECT DISTINCT company FROM contacts WHERE contact_pool=? AND simulated=0 AND trim(company)!='' ORDER BY company COLLATE NOCASE",(project_scope.contact_pool(c),))]
        unique={}
        for name in names:unique.setdefault(norm(name),name)
        return list(unique.values())

    def sources_from_contacts(self,item):
        from data_connectors import PROVIDERS
        available={norm(name):name for name in self.contact_companies()}
        rows=item.get('companies',[{'company':name} for name in available.values()])
        kinds=item.get('kinds',list(PROVIDERS)+['page','rss','json'])
        if not isinstance(rows,list) or not 1<=len(rows)<=5000:raise ValueError('Wybierz od 1 do 5000 firm z Kontaktów')
        if not isinstance(kinds,list) or not kinds or any(k not in (*PROVIDERS,'page','rss','json') for k in kinds):raise ValueError('Wybierz rodzaje źródeł')
        with self.db() as c:
            configured={(norm(r['company'].strip()),r['kind']) for r in c.execute('SELECT company,kind FROM signal_sources WHERE deleted=0')}
        plans=[];skipped=[];seen=set();already_configured=0
        for row in rows:
            if not isinstance(row,dict):raise ValueError('Nieprawidłowe dane firmy')
            key=norm(str(row.get('company','')).strip())
            if key not in available:raise ValueError('Wybierz firmy obecne w Kontaktach')
            if key in seen:continue
            seen.add(key);company=available[key]
            for kind in dict.fromkeys(kinds):
                source={'company':company,'kind':kind,'auto_accept':False}
                if kind in ('google_news','gdelt'):
                    source['config']={'search_term':row.get('search_term') or company,'days':30}
                elif kind in ('greenhouse','lever'):
                    board=str(row.get(kind+'_board','')).strip();region='global'
                    if not board:
                        if (key,kind) in configured:
                            already_configured+=1;continue
                        skipped.append({'company':company,'kind':kind,'reason':'Brak identyfikatora tablicy'});continue
                    if '://' in board:
                        parsed=public_url(board)
                        hosts=('boards.greenhouse.io','job-boards.greenhouse.io') if kind=='greenhouse' else ('jobs.lever.co','jobs.eu.lever.co')
                        if parsed.hostname not in hosts:raise ValueError('Nieprawidłowy adres tablicy pracodawcy')
                        region='eu' if parsed.hostname=='jobs.eu.lever.co' else 'global'
                        board=parsed.path.strip('/').split('/')[0]
                    source['config']={'board':board,'region':region}
                else:
                    address=str(row.get(kind+'_url','')).strip()
                    if not address:
                        if (key,kind) in configured:
                            already_configured+=1;continue
                        skipped.append({'company':company,'kind':kind,'reason':'Brak adresu źródła'});continue
                    source['url']=address if '://' in address else 'https://'+address
                    source['name']={'page':'Strona firmy','rss':'RSS / Atom','json':'JSON'}[kind]+' · '+company
                plans.append(self.source_values(source))
        created=0;existing=already_configured
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            for values in plans:
                _,added=self.save_source(c,values)
                created+=int(added);existing+=int(not added)
        return {'created':created,'existing':existing,'skipped':skipped,'companies':len(seen)}

    def record(self,item,source=None,connection=None):
        company=str(item.get('company','')).strip();kind=item['kind']; title=str(item['title']).strip();evidence=str(item['evidence']).strip()
        if item.get('scope')=='market':company=''
        topic=str(item.get('topic','')).strip() if not company else ''
        if not company and not 2<=len(topic)<=150:raise ValueError('Podaj temat rynku od 2 do 150 znaków')
        url=str(item['url']).strip(); public_url(url)
        if kind not in CATALOG or (not company and item.get('scope')!='market') or not title or not evidence: raise ValueError('Podaj firmę lub zakres rynkowy, typ, tytuł, dowód i adres źródła')
        occurred=timestamp(item.get('occurred'));source_date=timestamp(item.get('source_date')); now=time.time()
        basis=occurred or source_date
        age=(now-basis)/86400 if basis else None
        if age is not None and age>90: raise ValueError('Sygnał jest starszy niż 90 dni')
        with (nullcontext(connection) if connection is not None else self.db()) as c:
            matching=c.execute("SELECT COUNT(*) FROM contacts WHERE company_key(company)=company_key(?) AND status='active' AND simulated=0 AND contact_pool=?",(company,project_scope.contact_pool(c))).fetchone()[0] if company else 0
            weight=CATALOG[kind]['weight']; freshness=10 if age is not None and age<=7 else 5 if age is not None and age<=30 else 0
            score=min(100,weight+freshness+(10 if matching else 0))
            reason=f'Waga typu: {weight}; świeżość: +{freshness}; aktywne kontakty tej firmy: +{10 if matching else 0}. To priorytet, nie pewność prawdziwości.'
            canonical=norm(company)+'|'+kind+'|'+url+'|'+norm(title)
            if not company:canonical+='|market|'+norm(topic)
            fingerprint=hashlib.sha256(canonical.encode()).hexdigest()
            status='accepted' if source and source['auto_accept'] else 'new'
            row=c.execute('INSERT OR IGNORE INTO sales_signals(source_id,company,kind,title,evidence,url,occurred,observed,score,explanation,status,fingerprint,source_date,source_date_kind,topic) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (source['id'] if source else None,company[:200],kind,title[:500],evidence[:5000],url[:2000],occurred,now,score,reason,status,fingerprint,source_date,str(item.get('source_date_kind',''))[:30],topic))
            return row.lastrowid if row.rowcount else None

    def status(self,item):
        if item['status'] not in ('accepted','dismissed','new'): raise ValueError('Nieprawidłowy status sygnału')
        with self.mail_lock,self.db() as c:
            if not c.execute('SELECT 1 FROM sales_signals WHERE id=?',(item['id'],)).fetchone(): raise ValueError('Nie znaleziono sygnału')
            c.execute('UPDATE sales_signals SET status=? WHERE id=?',(item['status'],item['id']))
            if item['status']!='accepted':
                c.execute("UPDATE messages SET status='cancelled' WHERE status='queued' AND EXISTS(SELECT 1 FROM signal_enrollments e WHERE e.signal_id=? AND e.campaign_id=messages.campaign_id AND e.contact_id=messages.contact_id)",(item['id'],))
        return self.apply_rules() if item['status']=='accepted' else 0

    def save_rule(self,item):
        kinds=item.get('kinds',[]); campaign_id=int(item['campaign_id']);score=int(item.get('min_score',60));days=int(item.get('max_age_days',30))
        if not isinstance(kinds,list) or not kinds or any(k not in CATALOG for k in kinds) or not 0<=score<=100 or not 1<=days<=90: raise ValueError('Wybierz typy, próg 0–100 i wiek 1–90 dni')
        with self.mail_lock,self.db() as c:
            project_scope.require_campaign(c,campaign_id)
            if not c.execute("SELECT 1 FROM campaigns WHERE id=? AND status!='deleted'",(campaign_id,)).fetchone(): raise ValueError('Nie znaleziono kampanii')
            previous=c.execute('SELECT id FROM signal_rules WHERE campaign_id=?',(campaign_id,)).fetchone()
            if not previous and c.execute('SELECT 1 FROM messages WHERE campaign_id=?',(campaign_id,)).fetchone():
                raise ValueError('Użyj nowego szkicu bez wiadomości, żeby nie połączyć odbiorców ręcznych z sygnałami')
            c.execute('INSERT INTO signal_rules(campaign_id,kinds,min_score,max_age_days,enabled) VALUES(?,?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET kinds=excluded.kinds,min_score=excluded.min_score,max_age_days=excluded.max_age_days,enabled=excluded.enabled',
                      (campaign_id,json.dumps(kinds),score,days,int(bool(item.get('enabled',True)))))
        return self.apply_rules()

    def apply_rules(self,campaign_id=None):
        enrolled=0
        with self.enroll_lock:
            with self.db() as c:
                rules=c.execute('SELECT * FROM signal_rules WHERE enabled=1'+(' AND campaign_id=?' if campaign_id is not None else ''), (campaign_id,) if campaign_id is not None else ()).fetchall()
            for rule in rules:
                kinds=json.loads(rule['kinds']); cutoff=time.time()-rule['max_age_days']*86400
                with self.db() as c:
                    signals=c.execute("SELECT * FROM sales_signals WHERE status='accepted' AND score>=? AND COALESCE(occurred,source_date,observed)>=? ORDER BY score DESC,id DESC",(rule['min_score'],cutoff)).fetchall()
                    campaign=c.execute('SELECT * FROM campaigns WHERE id=?',(rule['campaign_id'],)).fetchone()
                    steps=c.execute('SELECT * FROM steps WHERE campaign_id=? ORDER BY position',(rule['campaign_id'],)).fetchall()
                if not campaign or not steps or campaign['status'] not in ('draft','active'): continue
                for signal in signals:
                    if not signal['company'].strip() or signal['kind'] not in kinds: continue
                    with self.db() as c:
                        contacts=c.execute("SELECT * FROM contacts WHERE company_key(company)=company_key(?) AND status='active' AND simulated=0 AND contact_pool=? AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.campaign_id=? AND m.contact_id=contacts.id) AND NOT EXISTS(SELECT 1 FROM signal_enrollments e WHERE e.campaign_id=? AND e.contact_id=contacts.id)",(signal['company'],project_scope.contact_pool(c,campaign['project_id']),campaign['id'],campaign['id'])).fetchall()
                    for contact in contacts:
                        if campaign['audience_mode']=='tags' and not contact_tags.matches(contact['tags'],campaign['audience_tags'],campaign['tag_match']):continue
                        if not sequence_conditions.matches(campaign['conditions'], contact,0):continue
                        context=dict(contact);context.update(signal_title=signal['title'],signal_evidence=signal['evidence'],signal_url=signal['url'],signal_type=CATALOG[signal['kind']]['label'])
                        messages=[]
                        for step in steps:
                            subject,body=self.ai_copy(context,campaign,step)
                            messages.append((campaign['id'],contact['id'],step['position'],subject,body,time.time()+step['delay_days']*86400))
                        with self.mail_lock,self.db() as c:
                            c.execute('BEGIN IMMEDIATE')
                            valid=c.execute("SELECT 1 FROM signal_rules r JOIN campaigns p ON p.id=r.campaign_id JOIN contacts t ON t.id=? JOIN sales_signals s ON s.id=? WHERE r.id=? AND r.enabled=1 AND p.status IN ('draft','active') AND t.status='active' AND t.simulated=0 AND s.status='accepted' AND campaign_matches(p.conditions,t.email,t.company,t.role)=1",(contact['id'],signal['id'],rule['id'])).fetchone()
                            current=c.execute('SELECT * FROM signal_rules WHERE id=?',(rule['id'],)).fetchone()
                            current_campaign=c.execute('SELECT * FROM campaigns WHERE id=?',(campaign['id'],)).fetchone()
                            current_contact=c.execute('SELECT tags FROM contacts WHERE id=?',(contact['id'],)).fetchone()
                            if current_campaign and current_campaign['audience_mode']=='tags' and (not current_contact or not contact_tags.matches(current_contact['tags'],current_campaign['audience_tags'],current_campaign['tag_match'])):continue
                            if not current or signal['kind'] not in json.loads(current['kinds']) or signal['score']<current['min_score'] or (signal['occurred'] or signal['source_date'] or signal['observed'])<time.time()-current['max_age_days']*86400: continue
                            if not valid or c.execute('SELECT 1 FROM signal_enrollments WHERE campaign_id=? AND contact_id=?',(campaign['id'],contact['id'])).fetchone() or c.execute('SELECT 1 FROM messages WHERE campaign_id=? AND contact_id=?',(campaign['id'],contact['id'])).fetchone(): continue
                            c.execute('INSERT INTO signal_enrollments(rule_id,campaign_id,contact_id,signal_id,created) VALUES(?,?,?,?,?)',(rule['id'],campaign['id'],contact['id'],signal['id'],time.time()))
                            c.executemany('INSERT INTO messages(campaign_id,contact_id,position,subject,body,due) VALUES(?,?,?,?,?,?)',messages)
                            enrolled+=1
        return enrolled

    def parse(self,source,content,url):
        if source['kind']=='json':
            data=json.loads(content); data=data.get('items') if isinstance(data,dict) else data
            if not isinstance(data,list): raise ValueError('JSON musi być listą lub obiektem z tablicą items')
            return data[:200],None
        if source['kind']=='page':
            p=Text();p.feed(content); chunks=list(dict.fromkeys(t for t in p.parts if len(t)>=30))[:3000]
            old=set(json.loads(source['snapshot'])) if source['snapshot'] else None
            added=[] if old is None else [t for t in chunks if t not in old]
            return [{'title':t[:250],'evidence':t,'url':url} for t in added[:200]],json.dumps(chunks)
        if '<!DOCTYPE' in content.upper() or '<!ENTITY' in content.upper(): raise ValueError('Niedozwolone deklaracje XML')
        root=ET.fromstring(content)
        items=[]
        for entry in root.iter():
            if entry.tag.split('}')[-1] not in ('item','entry'): continue
            fields={child.tag.split('}')[-1]: child for child in entry}
            def val(*names):
                return next((''.join(fields[n].itertext()) for n in names if n in fields),'')
            link=val('link')
            if not link and 'link' in fields: link=fields['link'].get('href','')
            items.append({'title':text(val('title')),'evidence':text(val('description','summary','content')) or text(val('title')),'url':urljoin(url,link) if link else url,'occurred':val('pubDate','published','updated') or None})
        return items[:200],None

    def scan(self,source_id=None,force=False):
        if languages.data_simulation(self.db):return {'created':0,'enrolled':0,'errors':[],'simulated':True}
        from data_connectors import PROVIDERS,load
        if not SCAN_LOCK.acquire(blocking=False): raise ValueError('Skanowanie już trwa')
        created=0;errors=[]
        try:
            with self.db() as c:
                sources=c.execute('SELECT * FROM signal_sources WHERE enabled=1 AND deleted=0'+(' AND id=?' if source_id is not None else ''),(source_id,) if source_id is not None else ()).fetchall()
            for source in sources:
                if languages.data_simulation(self.db):break
                if source['next_retry'] and source['next_retry']>time.time():
                    if force:errors.append({'source_id':source['id'],'error':'Źródło czeka na ponowienie: '+(source['last_error'] or 'limit zapytań')})
                    continue
                if not force and source_id is None and not source['next_retry'] and source['last_checked'] and time.time()-source['last_checked']<source['interval_minutes']*60: continue
                try:
                    if source['kind'] in PROVIDERS:
                        batch=load(source);items=batch['items'];url=batch['url'];snapshot=None
                    else:
                        content,url=fetch_public(source['url']);items,snapshot=self.parse(source,content,url)
                        batch={'total':len(items),'warning':''}
                    source_count=0
                    with self.db() as c:
                        c.execute('BEGIN IMMEDIATE')
                        if not c.execute('SELECT 1 FROM signal_sources WHERE id=? AND enabled=1 AND deleted=0',(source['id'],)).fetchone():continue
                        for item in items:
                            if not isinstance(item,dict): raise ValueError('Element źródła musi być obiektem')
                            # Market sources never infer ownership, even if a feed item names a company.
                            market=not source['company'].strip()
                            config=json.loads(source['config'])
                            if not market and item.get('company') and norm(item['company'])!=norm(source['company']): continue
                            evidence=text(item.get('evidence',item.get('description','')));title=text(item.get('title',''))
                            occurred=timestamp(item.get('occurred'));source_date=timestamp(item.get('source_date'))
                            if (occurred or source_date) and (occurred or source_date)<time.time()-90*86400: continue
                            combined=title+' '+evidence
                            if market:
                                if not has_phrase(combined,config.get('topic','')):continue
                            elif source['kind']!='page' and not item.get('company') and not has_phrase(combined,source['company']): continue
                            if item.get('kind') and item['kind'] not in CATALOG: raise ValueError('Nieznany typ sygnału w JSON')
                            detected=[item['kind']] if item.get('kind') in CATALOG else [k for k,v in CATALOG.items() if any(has_phrase(combined,w) for w in v['keywords'])]
                            if market and not detected:detected=['market_news']
                            selected=json.loads(source['signal_kinds'])
                            if selected:detected=[kind for kind in detected if kind in selected]
                            for kind in detected:
                                record={'company':source['company'],'scope':'market' if market else 'company','topic':config.get('topic',''),'kind':kind,'title':title,'evidence':evidence or title,'url':urljoin(url,str(item.get('url',url))),'occurred':occurred,'source_date':source_date,'source_date_kind':item.get('source_date_kind','')}
                                source_count+=int(self.record(record,source,connection=c) is not None)
                        c.execute('UPDATE signal_sources SET last_checked=?,last_success=?,last_error=NULL,next_retry=NULL,last_warning=?,last_total=?,last_matched=?,last_created=?,snapshot=COALESCE(?,snapshot) WHERE id=?',(time.time(),time.time(),batch['warning'],batch['total'],len(items),source_count,snapshot,source['id']))
                    created+=source_count
                except Exception as exc:
                    # No remote credentials or response bodies enter logs.
                    error=str(exc) if isinstance(exc,ValueError) else 'Nie udało się pobrać lub odczytać źródła'
                    errors.append({'source_id':source['id'],'error':error[:300]})
                    retry_at=getattr(exc,'retry_at',None) or time.time()+300
                    with self.db() as c: c.execute('UPDATE signal_sources SET last_checked=?,last_error=?,next_retry=? WHERE id=? AND deleted=0',(time.time(),error[:300],retry_at,source['id']))
            enrolled=self.apply_rules()
            return {'created':created,'enrolled':enrolled,'errors':errors}
        finally: SCAN_LOCK.release()

    def post(self,path,item):
        if path=='sources': return {'id':self.source(item)}
        if path=='sources/contacts':return {'companies':self.contact_companies()}
        if path=='sources/from-contacts':return self.sources_from_contacts(item)
        if path=='source/delete':
            self.delete_source(int(item['id']))
            return {'ok':True}
        if path=='source/status':
            with self.db() as c:
                if not c.execute('UPDATE signal_sources SET enabled=? WHERE id=? AND deleted=0',(int(bool(item['enabled'])),int(item['id']))).rowcount:raise ValueError('Nie znaleziono źródła')
        elif path=='record': return {'id':self.record(item)}
        elif path=='status': return {'enrolled':self.status(item)}
        elif path=='rules': return {'enrolled':self.save_rule(item)}
        elif path=='scan': return self.scan(int(item['id']) if item.get('id') else None,force=True)
        elif path=='apply': return {'enrolled':self.apply_rules()}
        else: raise ValueError('Nieznana operacja sygnałów')
        return {'ok':True}

    def worker(self):
        while True:
            try: self.scan()
            except Exception:
                with self.db() as c:
                    c.execute('INSERT INTO events(created,detail) VALUES(?,?)',(time.time(),'Błąd przetwarzania sygnałów lub generowania wiadomości. Sprawdź źródła i konfigurację AI.'))
            time.sleep(60)
