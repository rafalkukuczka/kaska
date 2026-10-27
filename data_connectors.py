"""Read-only adapters for public news and employer job-board sources."""
import json
import re
import threading
import time
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlencode, urlparse
import sales_signals as ss

PROVIDERS = {
 'google_news': {'key':'google_news','name':'Google News RSS','description':'Wzmianki o firmie i kandydaci na zdarzenia z nagłówków wiadomości.','needs_board':False,'docs':'https://news.google.com/','interval':60},
 'gdelt': {'key':'gdelt','name':'GDELT DOC 2.0','description':'Globalny indeks wiadomości. Dostawca może ograniczać liczbę zapytań.','needs_board':False,'docs':'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/','interval':60},
 'greenhouse': {'key':'greenhouse','name':'Greenhouse Job Board','description':'Publiczne oferty pracy z tablicy rekrutacyjnej konkretnego pracodawcy.','needs_board':True,'docs':'https://docs.greenhouse.io/job-board.html','interval':360},
 'lever': {'key':'lever','name':'Lever Postings','description':'Publiczne oferty pracy pracodawcy; instancja globalna lub europejska.','needs_board':True,'docs':'https://github.com/lever/postings-api','interval':360},
}
_LOCK=threading.Lock()
_CACHE={}
_LAST={}


class ConnectorError(ValueError):
    def __init__(self,message,retry_at=None):
        super().__init__(message);self.retry_at=retry_at


def configure(item):
    kind=item['kind'];company=str(item.get('company','')).strip()
    config=item.get('config',{})
    if not isinstance(config,dict):raise ValueError('Nieprawidłowa konfiguracja integracji')
    if kind not in PROVIDERS or (not company and (kind not in ('google_news','gdelt') or not config.get('search_term'))):raise ValueError('Wybierz integrację i podaj firmę lub temat rynku')
    if kind in ('google_news','gdelt'):
        term=str(config.get('search_term') or company).strip()
        if not 2<=len(term)<=150 or any(c in term for c in '\r\n"\\'):raise ValueError('Podaj nazwę do wyszukania bez cudzysłowów, od 2 do 150 znaków')
        days=int(config.get('days',30))
        if not 1<=days<=90:raise ValueError('Zakres wiadomości: 1–90 dni')
        config={'search_term':term,'days':days}
        if kind=='google_news':url='https://news.google.com/rss/search?'+urlencode({'q':'"'+term+'" when:'+str(days)+'d','hl':'pl','gl':'PL','ceid':'PL:pl'})
        else:url='https://api.gdeltproject.org/api/v2/doc/doc?'+urlencode({'query':'"'+term+'"','mode':'artlist','format':'json','maxrecords':100,'timespan':str(days)+'d','sort':'datedesc'})
    else:
        board=str(config.get('board','')).strip()
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',board):raise ValueError('Podaj identyfikator tablicy pracodawcy, nie pełny adres URL')
        region=config.get('region','global')
        if region not in ('global','eu'):raise ValueError('Instancja Lever: global lub eu')
        config={'board':board,'region':region}
        if kind=='greenhouse':url='https://boards-api.greenhouse.io/v1/boards/'+board+'/jobs'
        else:url=('https://api.eu.lever.co/' if region=='eu' else 'https://api.lever.co/')+'v0/postings/'+board+'?'+urlencode({'mode':'json','limit':25,'skip':0})
    return url,config


def _fetch(url,kind):
    # Share short-lived responses across companies/simultaneous actions, never secrets.
    with _LOCK:
        cached=_CACHE.get(url)
        if cached and time.time()-cached[0]<60:return cached[1],cached[2],True
        gap=5 if kind=='gdelt' else 1
        remaining=gap-(time.monotonic()-_LAST.get(kind,-1000))
        if remaining>0:
            if kind=='gdelt':raise ConnectorError('Integracja czeka na odstęp między zapytaniami. Spróbuj ponownie za kilka sekund.',time.time()+remaining)
            time.sleep(remaining)
        try:
            content,final=ss.fetch_public(url,max_bytes=4_000_000)
        except ss.FetchError as exc:
            retry_at=time.time()+max(exc.retry_after or 0,300 if exc.status==429 else 60)
            message='Dostawca ograniczył zapytania (HTTP 429). Ponowienie po okresie oczekiwania.' if exc.status==429 else 'Dostawca zwrócił HTTP '+str(exc.status)
            raise ConnectorError(message,retry_at) from None
        except (OSError,TimeoutError):
            raise ConnectorError('Nie udało się połączyć z dostawcą. Ponowimy później.',time.time()+60) from None
        finally:_LAST[kind]=time.monotonic()
        _CACHE[url]=(time.time(),content,final)
        return content,final,False


def _json(content):
    try:return json.loads(content)
    except json.JSONDecodeError:
        if 'limit' in content.lower():raise ConnectorError('Dostawca zwrócił ograniczenie zapytań zamiast danych.',time.time()+300) from None
        raise ConnectorError('Dostawca nie zwrócił poprawnych danych JSON.') from None


def job_kind(title):
    value=ss.norm(title)
    patterns=[('leadership_hiring',r'\b(vp|vice president|chief|head of|director|dyrektor)\b'),
              ('sales_hiring',r'\b(sales|sdr|bdr|account executive|business development|handlow|sprzedaz)'),
              ('marketing_hiring',r'\b(marketing|growth marketer|content manager)'),
              ('it_hiring',r'\b(engineer|developer|programist|devops|software|data scientist|informatyk)')]
    return next((kind for kind,pattern in patterns if re.search(pattern,value)),'hiring')


def _job(source,title,url,description='',published=None,updated=None):
    ss.public_url(url)
    evidence='Publiczna oferta pracy: '+title+'.'
    if description:evidence+=' '+ss.text(unescape(description))[:1000]
    if updated:evidence+=' Aktualizacja podana przez źródło: '+str(updated)+'.'
    return {'company':source['company'],'kind':job_kind(title),'title':source['company']+' — '+title,
            'evidence':evidence,'url':url,'occurred':None,'source_date':published,'source_date_kind':'publication'}


def load(source):
    kind=source['kind'];config=json.loads(source['config']);company=source['company']
    expected,_=configure({'kind':kind,'company':company,'config':config})
    if source['url']!=expected:raise ValueError('Adres integracji nie odpowiada konfiguracji. Utwórz źródło ponownie.')
    content,url,cached=_fetch(expected,kind)
    items=[];warning='';total=0
    if kind=='google_news':
        # Use the existing bounded XML parser, then require the configured name in the headline.
        parsed,_=ss.Engine.parse(None,{'kind':'rss'},content,url)
        total=len(parsed)
        items=[dict(item,company=company,occurred=None,source_date=item.get('occurred'),source_date_kind='publication') for item in parsed if ss.has_phrase(item['title'],config['search_term'])]
        warning='Nagłówki są wskazówką do weryfikacji; wzmianka nie potwierdza zdarzenia. Link prowadzi przez Google News.'
    elif kind=='gdelt':
        data=_json(content)
        if not isinstance(data,dict) or not isinstance(data.get('articles'),list):raise ValueError('GDELT nie zwrócił listy articles')
        total=len(data['articles'])
        for row in data['articles'][:100]:
            title=ss.text(row.get('title',''))
            if not ss.has_phrase(title,config['search_term']):continue
            try:ss.public_url(row['url'])
            except (KeyError,ValueError):continue
            raw_date=row.get('seendate')
            occurred=datetime.strptime(raw_date,'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp() if raw_date else None
            items.append({'company':company,'title':title,'evidence':title+' — nagłówek z indeksu GDELT; czas indeksacji, nie potwierdzona data zdarzenia.','url':row['url'],'occurred':None,'source_date':occurred,'source_date_kind':'indexing'})
        warning='Przetwarzane są nagłówki z indeksu. Czas indeksacji nie jest datą zdarzenia.'
    elif kind=='greenhouse':
        data=_json(content)
        if not isinstance(data,dict) or not isinstance(data.get('jobs'),list):raise ValueError('Greenhouse nie zwrócił listy jobs')
        total=len(data['jobs'])
        jobs=sorted(data['jobs'],key=lambda row:ss.timestamp(row.get('first_published')) or 0,reverse=True)
        for row in jobs[:200]:
            title=ss.text(row.get('title',''))
            if title:items.append(_job(source,title,row['absolute_url'],str(row.get('location',{}).get('name','')),row.get('first_published'),row.get('updated_at')))
        if total>200:warning='Tablica zawiera więcej niż 200 ofert. Ten skan przetwarza 200 ofert z najnowszą dostępną datą publikacji.'
    elif kind=='lever':
        rows=[];data=_json(content)
        if not isinstance(data,list):raise ValueError('Lever nie zwrócił listy ofert')
        rows.extend(data)
        # Follow at most four fixed-host pages. No arbitrary next URLs from remote input.
        for page in range(1,4):
            if len(data)<25:break
            next_url=expected.replace('skip=0','skip='+str(page*25))
            try:body,_,_= _fetch(next_url,kind)
            except ConnectorError:
                warning='Odczyt częściowy: nie udało się pobrać kolejnej strony ofert.';break
            data=_json(body)
            if not isinstance(data,list):raise ValueError('Nieprawidłowa strona wyników Lever')
            rows.extend(data)
        total=len(rows)
        if len(rows)>=100:warning='Odczytano do 100 ofert; większe tablice mogą zawierać dodatkowe wyniki.'
        for row in rows[:100]:
            title=ss.text(row.get('text',''))
            published=float(row['createdAt'])/1000 if row.get('createdAt') else None
            if title:items.append(_job(source,title,row['hostedUrl'],row.get('descriptionPlain',''),published))
    return {'items':items,'total':total,'warning':warning,'cached':cached,'url':url}
