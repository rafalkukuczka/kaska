"""Public website knowledge and material selection for outbound campaigns."""
import json
import re
import time
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urldefrag
from sales_signals import fetch_public, public_url, norm
from languages import validate_language

STOP = set('the and for with from that this your our are you what how into will have company firma firmy oraz dla przez jest sie przy'.split())


class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.skip=0;self.title=[];self.in_title=False;self.parts=[];self.links=[];self.anchor=None;self.description=''
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('script','style','nav','footer','noscript'):self.skip+=1
        if tag=='title':self.in_title=True
        if tag=='a' and a.get('href'):self.anchor=[a['href'],'']
        if tag=='meta' and a.get('name','').lower()=='description':self.description=a.get('content','')
    def handle_endtag(self,tag):
        if tag in ('script','style','nav','footer','noscript'):self.skip=max(0,self.skip-1)
        if tag=='title':self.in_title=False
        if tag=='a' and self.anchor:self.links.append(tuple(self.anchor));self.anchor=None
    def handle_data(self,data):
        if self.anchor:self.anchor[1]+=data+' '
        if self.in_title:self.title.append(data)
        if not self.skip and data.strip():self.parts.append(data.strip())


def domain(url):return urlparse(url).hostname.lower().removeprefix('www.')


def tokens(text):return set(re.findall(r'[a-z0-9#+.]{3,}',norm(text)))-STOP


def init_schema(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS content_profiles(id INTEGER PRIMARY KEY,website TEXT NOT NULL UNIQUE,name TEXT NOT NULL,offer TEXT NOT NULL,updated REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY,website TEXT NOT NULL,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,summary TEXT NOT NULL,tags TEXT NOT NULL,kind TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,fetched REAL NOT NULL);
    ''')
    columns={r[1] for r in c.execute('PRAGMA table_info(campaigns)')}
    if 'proof_points' not in columns:c.execute("ALTER TABLE campaigns ADD COLUMN proof_points TEXT NOT NULL DEFAULT ''")
    if 'conditions' not in columns:c.execute("ALTER TABLE campaigns ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]'")
    for name,definition in [('website',"TEXT NOT NULL DEFAULT ''"),('audience_mode',"TEXT NOT NULL DEFAULT 'all'"),('contact_ids',"TEXT NOT NULL DEFAULT '[]'"),('material_mode',"TEXT NOT NULL DEFAULT 'none'"),('material_ids',"TEXT NOT NULL DEFAULT '[]'"),('language',"TEXT NOT NULL DEFAULT 'pl'"),('cta',"TEXT NOT NULL DEFAULT ''"),('cta_url',"TEXT NOT NULL DEFAULT ''"),('pain_points',"TEXT NOT NULL DEFAULT ''"),('value_props',"TEXT NOT NULL DEFAULT ''")]:
        if name not in columns:c.execute('ALTER TABLE campaigns ADD COLUMN '+name+' '+definition)


class Library:
    def __init__(self,db):self.db=db

    def state(self):
        with self.db() as c:return {'profiles':[dict(r) for r in c.execute('SELECT * FROM content_profiles ORDER BY updated DESC')],'materials':[dict(r) for r in c.execute('SELECT * FROM materials ORDER BY id DESC LIMIT 2000')]}

    def page(self,url):
        content,final=fetch_public(url)
        p=Page();p.feed(content)
        title=' '.join(p.title).strip()[:300] or final
        summary=(p.description or ' '.join(p.parts)[:1200]).strip()[:1600]
        body=' '.join(p.parts)[:16000]
        if len(body)<60:raise ValueError('Strona nie zawiera wystarczającej treści HTML')
        words=re.findall(r'[a-z0-9#+.]{3,}',norm(title+' '+title+' '+summary+' '+body))
        tags=[word for word,_ in Counter(w for w in words if w not in STOP).most_common(20)]
        kind='case_study' if 'case' in final.lower() else 'article' if any(x in final.lower() for x in ('knowledge','blog','article')) else 'service'
        return {'url':final,'title':title,'summary':summary,'excerpt':body,'tags':tags,'kind':kind,'links':p.links}

    def discover(self,website):
        if '://' not in website:website='https://'+website
        public_url(website)
        root=self.page(website)
        website=root['url'].rstrip('/')+'/'
        candidates={}
        for href,label in root['links']:
            url=urldefrag(urljoin(website,href))[0]
            p=urlparse(url)
            if p.scheme!='https' or not p.hostname or domain(url)!=domain(website) or url.rstrip('/')==website.rstrip('/') or p.query:continue
            key=norm(p.path+' '+label)
            if any(x in key for x in ('privacy','career','kontakt','contact','about','login','mailto:','.png','.jpg','.svg')):continue
            score=sum(5 for x in ('case-stud','success','knowledge','service','solution','product','blog','article','resource','oferta','uslugi','produkty','realizacje','poradnik','wiedza') if x in key)
            if score:candidates[url]=score
        rows=[root];errors=[]
        for url in sorted(candidates,key=candidates.get,reverse=True)[:10]:
            try:
                row=self.page(url)
                if domain(row['url'])!=domain(website):raise ValueError('Przekierowanie poza domenę firmy')
                rows.append(row)
            except Exception:errors.append({'url':url,'error':'Nie udało się odczytać tej podstrony'})
        with self.db() as c:
            c.execute('INSERT INTO content_profiles(website,name,offer,updated) VALUES(?,?,?,?) ON CONFLICT(website) DO UPDATE SET name=excluded.name,offer=excluded.offer,updated=excluded.updated',
                (website,domain(website),root['summary'],time.time()))
            for row in rows:self.store(c,website,row)
        return {'website':website,'offer':root['summary'],'added':len(rows),'errors':errors}

    def store(self,c,website,row):
        c.execute('INSERT INTO materials(website,url,title,summary,tags,kind,fetched) VALUES(?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,summary=excluded.summary,tags=excluded.tags,kind=excluded.kind,fetched=excluded.fetched',
            (website,row['url'],row['title'],row['summary'],json.dumps(row['tags']),row['kind'],time.time()))

    def add(self,item):
        url=str(item['url']).strip();website=str(item['website']).strip()
        if '://' not in url:url='https://'+url
        if '://' not in website:website='https://'+website
        row=self.page(url)
        public_url(website)
        if domain(row['url'])!=domain(website):raise ValueError('Materiał musi należeć do domeny wybranej firmy')
        with self.db() as c:self.store(c,website,row)
        return {'ok':True}

    def select(self,contact,campaign):
        campaign=dict(campaign);mode=campaign.get('material_mode','none');website=campaign.get('website','')
        if mode=='none' or not website:return None
        with self.db() as c:rows=[dict(r) for r in c.execute('SELECT * FROM materials WHERE enabled=1')]
        rows=[r for r in rows if domain(r['website'])==domain(website)]
        if mode=='manual':
            ids=json.loads(campaign.get('material_ids','[]'));rows=[r for r in rows if r['id'] in ids]
        context=' '.join(str(v) for k,v in dict(contact).items() if k in ('role','notes','signal_title','signal_evidence','signal_type'))+' '+campaign.get('audience','')+' '+campaign.get('pain_points','')
        query=tokens(context)
        for row in rows:
            # Rank title, subject tags, then descriptive context. No invented fit.
            row['match_score']=len(query & tokens(row['title']))*4+len(query & tokens(' '.join(json.loads(row['tags']))))*5+len(query & tokens(row['summary']))
        rows.sort(key=lambda r:(r['match_score'],r['kind']=='case_study'),reverse=True)
        if not rows or (mode=='auto' and rows[0]['match_score']==0):return None
        return rows[0]

    def validate_campaign(self,c,item):
        mode=item.get('audience_mode','all'); material_mode=item.get('material_mode','none')
        ids=item.get('contact_ids',[]);materials=item.get('material_ids',[])
        if mode not in ('all','selected','signals','group','tags') or material_mode not in ('none','auto','manual'):raise ValueError('Nieprawidłowy tryb odbiorców lub materiałów')
        if not isinstance(ids,list) or not isinstance(materials,list):raise ValueError('Lista kontaktów i materiałów musi być tablicą')
        ids=list(dict.fromkeys(int(i) for i in ids));materials=list(dict.fromkeys(int(i) for i in materials))
        if mode=='selected' and not ids:raise ValueError('Wybierz co najmniej jednego odbiorcę')
        for contact_id in ids:
            if not c.execute('SELECT 1 FROM contacts WHERE id=?',(contact_id,)).fetchone():raise ValueError('Nieznany kontakt')
        website=str(item.get('website','')).strip()
        if website and '://' not in website:website='https://'+website
        if website:public_url(website)
        if material_mode!='none' and not website:raise ValueError('Podaj stronę nadawcy do wyboru materiałów')
        if material_mode=='manual' and not materials:raise ValueError('Wybierz materiał do wysłania')
        for material_id in materials:
            row=c.execute('SELECT * FROM materials WHERE id=? AND enabled=1',(material_id,)).fetchone()
            if not row or not website or domain(row['website'])!=domain(website):raise ValueError('Materiał nie należy do wybranej firmy lub został wyłączony')
        language=item.get('language','pl')
        validate_language(language)
        cta_url=str(item.get('cta_url','')).strip()
        if cta_url:public_url(cta_url)
        proof_points=item.get('proof_points','')
        if not isinstance(proof_points,str) or len(proof_points)>10000:raise ValueError('Proof points: maksymalnie 10000 znaków.')
        return (website,mode,json.dumps(ids),material_mode,json.dumps(materials),language,str(item.get('cta','')).strip(),cta_url,str(item.get('pain_points','')).strip(),str(item.get('value_props','')).strip(),proof_points.strip())

    def post(self,path,item):
        if path=='discover':return self.discover(str(item['website']).strip())
        if path=='add':return self.add(item)
        if path=='status':
            with self.db() as c:c.execute('UPDATE materials SET enabled=? WHERE id=?',(int(bool(item['enabled'])),int(item['id'])))
            return {'ok':True}
        raise ValueError('Nieznana operacja biblioteki')
