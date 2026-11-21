"""Evidence-backed contact acquisition from Discover, with explicit grouped import."""
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from urllib.parse import urlparse

import contact_groups
import contact_tags
import languages
import lead_sources
import shared_project
import project_scope
from prospecting import Hunter,clean_domain,safe_link
from contact_enrichment import waterfall


def init_schema(c):
    c.execute('''CREATE TABLE IF NOT EXISTS discover_contact_searches(
      id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES seller_projects(id),
      company TEXT NOT NULL,domain TEXT NOT NULL,organization TEXT NOT NULL,
      contacts TEXT NOT NULL,context TEXT NOT NULL,created REAL NOT NULL)''')
    if 'research_data' not in {row[1] for row in c.execute('PRAGMA table_info(contacts)')}:
        c.execute("ALTER TABLE contacts ADD COLUMN research_data TEXT NOT NULL DEFAULT '{}'")


def contact_attributes(person, sources, domain):
    fields = {}
    for key in ('first_name','last_name','department','seniority','city','state','country','provider'):
        value = person.get(key)
        if isinstance(value, str) and value.strip():
            fields[key] = value.strip()[:250]
    linkedin = safe_link(person.get('linkedin') or person.get('linkedin_url') or '')
    if linkedin and (urlparse(linkedin).hostname or '').lower().removeprefix('www.') == 'linkedin.com':
        fields['linkedin'] = linkedin
    phone = person.get('work_phone') or (person.get('phone_number') if person.get('phone_type') == 'work' else '')
    if isinstance(phone, str) and re.fullmatch(r'[+0-9(). /-]{6,45}', phone.strip()):
        fields['work_phone'] = phone.strip()
    return {**fields,'domain':domain,'sources':sources}


def merge_attributes(previous, current):
    result = {**current, **previous}
    sources = {item['url']:item for item in previous.get('sources', [])}
    for item in current.get('sources', []):
        old = sources.get(item['url'], {})
        if item.get('last_seen', '') >= old.get('last_seen', ''):
            sources[item['url']] = item
    result['sources'] = list(sources.values())[:40]
    return result


def research_source(value):
    if not isinstance(value, str) or len(value) > 2000:
        return ''
    try:
        url = urlparse(value.strip())
        if url.scheme in ('http','https') and url.hostname and url.username is None and url.port in (None,443):
            return url._replace(scheme='https',fragment='').geturl()
    except ValueError:
        pass
    return ''


class DiscoverContacts:
    def __init__(self,db,add_contact,browser_reader=None):
        self.db,self.add_contact,self.browser_reader=db,add_contact,browser_reader
        self.status_lock = threading.Lock()
        self.status_by_company = {}

    def research_status(self, project_id):
        with self.status_lock:
            rows = [dict(row) for (project, _),row in self.status_by_company.items() if project == project_id]
        return sorted(rows, key=lambda row:(row['status'] != 'running',-row['updated']))[:12]

    def update_status(self, key, **fields):
        with self.status_lock:
            self.status_by_company[key].update(updated=time.time(), **fields)
            if len(self.status_by_company) > 100:
                finished = [key for key,row in self.status_by_company.items() if row['status'] != 'running']
                if finished:
                    del self.status_by_company[min(finished,key=lambda key:self.status_by_company[key]['updated'])]

    def browser_contacts(self, pages, domain, company, limit):
        people = {}
        for page in pages:
            source = research_source(page.get('source'))
            if not source:
                continue
            for contact in page.get('contacts', []):
                email = str(contact.get('email', '')).strip().lower()
                if (len(email)>254 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', email)
                        or email.rsplit('@',1)[1]!=domain):
                    continue
                name = str(contact.get('name') or '').strip()
                current = people.setdefault(email, {'value':email,'type':'web','provenance':'found',
                    'first_name':'','position':'','work_phone':'','provider':'Strona źródłowa','sources':[]})
                current['first_name'] = current['first_name'] or name
                current['position'] = current['position'] or contact.get('role')
                current['work_phone'] = current['work_phone'] or contact.get('phone')
                if not any(item['uri']==source for item in current['sources']):
                    current['sources'].append({'uri':source,'last_seen_on':date.today().isoformat()})
        results = sorted(people.values(), key=lambda person: not person['first_name'])[:limit]
        for person in results:
            person['first_name'] = person['first_name'] or company
        return results

    def automatic_search(self, firm, domain, params, limit, titles, project_id):
        home = f'https://{domain}/' if domain else ''
        urls = list(dict.fromkeys([*firm.get('source_urls', []), *([home] if home else [])])) if self.browser_reader else []
        key = (project_id, domain or firm['company'].casefold())
        with self.status_lock:
            if self.status_by_company.get(key, {}).get('status') == 'running':
                raise ValueError('Badanie tej firmy już trwa.')
            self.status_by_company[key] = {'company':firm['company'],'domain':domain,'status':'running','stage':'website',
                                           'completed':0,'total':len(urls),'found':0,'errors':0,'updated':time.time()}
        try:
            result = self.read_contact_sources(firm, domain, params, limit, titles, key, urls, home)
        except Exception:
            self.update_status(key,status='failed',stage='finished')
            raise
        self.update_status(key,status='done',stage='finished',found=len(result.get('emails', [])))
        return result

    def read_contact_sources(self, firm, domain, params, limit, titles, key, urls, home):
        trace = []
        if urls:
            pages = {}
            errors = 0
            with ThreadPoolExecutor(max_workers=3) as pool:
                tasks = {pool.submit(self.browser_reader, url, follow_links=url==home):url for url in urls}
                for completed,task in enumerate(as_completed(tasks),1):
                    url = tasks[task]
                    try:
                        batch = task.result()['pages']
                        pages[url] = batch
                        found = self.browser_contacts(batch,domain,firm['company'],limit)
                        trace.append({'provider':'Chrome headless','status':'ok','added':len(found),
                                      'urls':list(dict.fromkeys([url,*[page['source'] for page in batch]]))})
                    except (ValueError, OSError) as error:
                        errors += 1
                        trace.append({'provider':'Chrome headless','status':'error','error':str(error),'urls':[url]})
                    self.update_status(key,completed=completed,errors=errors)
            people = self.browser_contacts((page for url in urls for page in pages.get(url, [])),domain,firm['company'],limit)
            if people:
                return {'domain':domain,'emails':people,'enrichment':trace}
        else:
            trace.append({'provider':'Chrome headless','status':'skipped','detail':'Brak domeny firmy.'})
        if not os.getenv('HUNTER_API_KEY', '').strip():
            trace.append({'provider':'Hunter','status':'skipped','detail':'Podłącz Huntera w Integracjach.'})
        else:
            try:
                self.update_status(key,stage='hunter')
                found = waterfall(Hunter(),domain,limit,titles,hunter_params=params)
                return {**found,'enrichment':[*trace,*found.get('enrichment',[])]}
            except ValueError as error:
                trace.append({'provider':'Hunter','status':'error','error':str(error)})
        return {'domain':domain,'emails':[],'enrichment':trace}

    def discover_sources(self, c, project, company):
        rows = c.execute("""SELECT domain,url,website,sources FROM discovered_opportunities WHERE project_id=? AND company=? COLLATE NOCASE
            UNION ALL SELECT p.domain,'','',p.sources FROM prospect_candidates p JOIN prospect_runs r ON r.id=p.run_id
            WHERE r.project_id=? AND p.company=? COLLATE NOCASE""", (project,company,project,company))
        urls, domains = [], set()
        for row in rows:
            if row['domain']:
                domains.add(row['domain'])
            entries = json.loads(row['sources'])
            candidates = [row['url'],row['website'], *[entry.get('url') or entry.get('uri') if isinstance(entry,dict) else entry
                                                     for entry in entries]]
            urls.extend(url for value in candidates if (url:=research_source(value)))
        return urls, next(iter(domains)) if len(domains)==1 else ''

    def person_tags(self,c,item,email):
        if 'tags_by_contact' in item:
            mapping=item['tags_by_contact']
            if not isinstance(mapping,dict) or len(mapping)>10:raise ValueError('Nieprawidłowe tagi kontaktów.')
            return contact_tags.normalize(c,mapping.get(email,[]))
        return contact_tags.normalize(c,item['tags'] if 'tags' in item else contact_groups.normalize(c,item.get('target_group','')))

    def add_simulated(self,item):
        project=shared_project.get(self.db,item.get('project_id'))
        if not languages.data_simulation(self.db):raise ValueError('Włącz symulację, aby zapisać fikcyjne kontakty.')
        if item.get('confirm_company') is not True:raise ValueError('Potwierdź zapis kontaktów z symulacji.')
        people=item.get('contacts');company=item.get('company','')
        if not isinstance(company,str) or len(company)>200:raise ValueError('Nieprawidłowa firma.')
        if not isinstance(people,list) or not 1<=len(people)<=10:raise ValueError('Wybierz od 1 do 10 kontaktów.')
        validated=[]
        for person in people:
            if not isinstance(person,dict):raise ValueError('Nieprawidłowy kontakt.')
            fields={key:person.get(key,'') for key in ('name','email','role')}
            if any(not isinstance(value,str) or len(value)>250 for value in fields.values()):raise ValueError('Nieprawidłowy kontakt.')
            email=fields['email'].strip().lower()
            if not re.fullmatch(r'[^\s@<>]+@(?:[a-z0-9-]+\.)+example',email) or not fields['name'].strip():raise ValueError('Kontakty z symulacji muszą używać fikcyjnej domeny .example.')
            attributes = person.get('attributes')
            department = attributes.get('department') if isinstance(attributes,dict) else None
            research = contact_attributes({'provider':'Symulacja','department':department}, [], email.rsplit('@',1)[1])
            validated.append({**fields,'email':email,'research':research})
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project['id'],)).fetchone():raise ValueError('Projekt został usunięty.')
            group='';added=existing=0
            for person in {p['email']:p for p in validated}.values():
                tags=self.person_tags(c,item,person['email']);group='; '.join(tags)
                if not group:raise ValueError('Dodaj co najmniej jeden tag każdemu zapisywanemu kontaktowi.')
                pool=project_scope.contact_pool(c,project['id'])
                row=c.execute('SELECT id,simulated,research_data FROM contacts WHERE email=? AND contact_pool=?',(person['email'],pool)).fetchone()
                if row:
                    existing+=1
                    if row['simulated']:
                        contact_tags.set_tags(c,row['id'],tags,merge='tags' in item or 'tags_by_contact' in item,project_id=project['id'])
                        research=merge_attributes(json.loads(row['research_data']),person['research'])
                        c.execute('UPDATE contacts SET research_data=? WHERE id=?',(json.dumps(research,ensure_ascii=False),row['id']))
                    continue
                self.add_contact(c,{**person,'project_id':project['id'],'company':company,'tags':tags,'notes':'Dane symulacyjne. Projekt: '+project['name']+'. Wykluczone z rzeczywistej wysyłki.'})
                c.execute('UPDATE contacts SET simulated=1,research_data=? WHERE email=? AND contact_pool=?',
                          (json.dumps(person['research'],ensure_ascii=False),person['email'],pool));added+=1
        return {'added':added,'existing':existing,'target_group':group,'simulated':True,'persisted':True}

    def search(self,item,*,researched_company=None):
        project=shared_project.get(self.db,item.get('project_id'))
        if languages.data_simulation(self.db):raise ValueError('Włączona jest symulacja pobierania. Rzeczywiste wyszukiwanie jest wyłączone.')
        company=item.get('company','')
        provider=item.get('provider')
        if provider not in (None, 'hunter', 'auto'):
            raise ValueError('Nieznany dostawca danych kontaktowych.')
        known_domain = ''
        if not isinstance(company,str) or not company.strip() or len(company)>200:raise ValueError('Nieprawidłowa firma.')
        with self.db() as c:
            names=[row['company'] for row in c.execute('SELECT DISTINCT p.company FROM prospect_candidates p JOIN prospect_runs r ON r.id=p.run_id WHERE r.project_id=?',(project['id'],))]
            names.extend(row['company'] for row in c.execute('SELECT DISTINCT company FROM discovered_opportunities WHERE project_id=?',(project['id'],)))
            names.extend(row['company'] for row in c.execute('SELECT DISTINCT company FROM contacts WHERE contact_pool=?',(project_scope.contact_pool(c,project['id']),)))
            name=next((name for name in names if name.casefold()==company.strip().casefold()),None)
            firm=researched_company or ({'company':name,'quote':'Firma z wyników wyszukiwania lub Kontaktów.'} if name else None)
            if firm and provider=='auto' and researched_company is None:
                firm['source_urls'],known_domain = self.discover_sources(c,project['id'],firm['company'])
        if not firm:raise ValueError('Wybierz firmę z Discover w tym projekcie.')
        limit=item.get('limit',5)
        if type(limit)!=int or not 1<=limit<=10:raise ValueError('Wybierz od 1 do 10 kontaktów.')
        domain=item.get('domain','');titles=item.get('titles','')
        if not isinstance(domain,str) or len(domain)>2000 or not isinstance(titles,str) or len(titles)>500:raise ValueError('Nieprawidłowa domena lub stanowiska.')
        domain=domain.strip()
        if '://' in domain:
            parsed=urlparse(domain)
            if parsed.scheme not in ('https','http') or parsed.username or parsed.password:raise ValueError('Podaj poprawną domenę firmy.')
            domain=parsed.hostname or ''
        domain=clean_domain(domain or known_domain) if domain or known_domain else ''
        params={'limit':limit,'type':'personal','provenance':'found','required_field':'full_name'}
        params.update({'domain':domain} if domain else {'company':firm['company']})
        if titles.strip():params['job_titles']=titles.strip()
        data = (self.automatic_search(firm,domain,params,limit,titles.strip(),project['id']) if provider=='auto' else
                waterfall(Hunter(),domain,limit,titles.strip(),hunter_params=params,allow_apollo=provider is None))
        if not isinstance(data,dict) or not isinstance(data.get('emails',[]),list):raise ValueError('Hunter zwrócił nieprawidłową listę kontaktów.')
        found_domain=clean_domain(data['domain']) if data.get('domain') else domain
        if domain and found_domain!=domain:raise ValueError('Hunter zwrócił inną domenę. Wynik nie został zapisany.')
        organization=str(data.get('organization') or firm['company'])[:250];contacts=[];seen=set()
        for person in data.get('emails',[])[:limit]:
            if not isinstance(person,dict):continue
            email=str(person.get('value') or '').strip().lower()
            if not found_domain or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',email) or len(email)>254 or email.rsplit('@',1)[1]!=found_domain:continue
            if person.get('type') not in ('personal','web') or person.get('provenance') not in (None,'found'):continue
            name=' '.join(str(person.get(key) or '').strip() for key in ('first_name','last_name')).strip()[:250]
            raw_sources=person.get('sources') or []
            if not isinstance(raw_sources,list):continue
            link = research_source if person.get('type')=='web' else safe_link
            sources=[{'url':link(source.get('uri','')),'last_seen':str(source.get('last_seen_on') or '')[:100],
                      'kind':str(source.get('kind') or 'email')[:40]} for source in raw_sources[:20] if isinstance(source,dict)]
            sources=[source for source in sources if source['url']]
            if not name or not sources or email in seen:continue
            seen.add(email)
            with self.db() as c:existing=c.execute('SELECT id,target_group,status FROM contacts WHERE email=? AND contact_pool=?',(email,project_scope.contact_pool(c,project['id']))).fetchone()
            contacts.append({'id':len(contacts),'name':name,'email':email,'role':str(person.get('position') or '')[:250],
                             'sources':sources,'provider':person.get('provider','Hunter'),
                             'attributes':contact_attributes(person, sources, found_domain),
                             'existing':dict(existing) if existing else None})
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project['id'],)).fetchone():raise ValueError('Projekt został usunięty.')
            search_id=c.execute('INSERT INTO discover_contact_searches(project_id,company,domain,organization,contacts,context,created) VALUES(?,?,?,?,?,?,?)',
                (project['id'],firm['company'],found_domain,organization,json.dumps(contacts,ensure_ascii=False),firm['quote'][:2000],time.time())).lastrowid
        return {'id':search_id,'company':firm['company'],'domain':found_domain,'organization':organization,'contacts':contacts,'enrichment':data.get('enrichment',[]),'simulated':False}

    def search_lead(self, item):
        domain = clean_domain(item.get('domain'))
        if type(item.get('search_id')) is not int:
            raise ValueError('Wybierz wyszukiwanie i firmę w Dashboardzie.')
        with self.db() as c:
            project = project_scope.active(c)
            if item.get('project_id', project) != project:
                raise ValueError('Projekt się zmienił. Otwórz wyniki wyszukiwania ponownie.')
            row = c.execute("""SELECT f.name,f.domain,f.url,f.evidence FROM lead_search_companies f JOIN lead_searches s ON s.id=f.search_id
                WHERE s.id=? AND s.project_id=? AND f.domain=?""", (item['search_id'],project,domain)).fetchone()
            profile = c.execute('SELECT profile FROM lead_company_profiles WHERE project_id=? AND domain=?',
                                (project,domain)).fetchone()
            signals = c.execute("""SELECT DISTINCT v.kind,v.url FROM lead_signals v
                JOIN lead_signal_subscriptions b ON b.run_id=v.run_id
                JOIN lead_signal_runs r ON r.id=b.run_id
                WHERE b.search_id=? AND r.domain=? AND v.source_date>=date('now','-30 days')""",
                                            (item['search_id'],domain)).fetchall()
            research = c.execute('SELECT pages FROM lead_research WHERE project_id=? AND domain=?',(project,domain)).fetchone()
        if not row:
            raise ValueError('Nie znaleziono firmy w tym wyszukiwaniu i projekcie.')
        company_profile = json.loads(profile['profile']) if profile else {}
        titles = lead_sources.contact_roles(company_profile,[signal['kind'] for signal in signals])
        request = {'project_id':project,'company':row['name'][:200],'domain':row['domain'],'limit':5,'titles':titles,
                   'provider':item.get('provider')}
        firm = {'company':row['name'],'quote':'Firma z wyników Dashboardu · '+row['domain']}
        evidence = json.loads(row['evidence'])
        cached_pages = json.loads(research['pages']) if research else []
        identity = company_profile.get('identity') or {}
        sources = [row['url'], *[signal['url'] for signal in signals], *[entry.get('url') for entry in [
            *evidence,*cached_pages,*company_profile.get('jobs', [])] if isinstance(entry,dict)], identity.get('url'), identity.get('register_url')]
        firm['source_urls'] = [url for source in sources if (url:=research_source(source))]
        result = self.search(request,researched_company=firm)
        if request['provider'] is None and titles and not result['contacts']:
            result = self.search({**request,'titles':''},researched_company=firm)
        return {**result,'suggested_roles':titles}

    def lead_tag_candidates(self, item):
        with self.db() as c:
            project_id = project_scope.active(c)
            if item.get('project_id') != project_id or type(item.get('search_id')) is not int:
                raise ValueError('Otwórz wyniki wyszukiwania w bieżącym projekcie.')
            firms = c.execute("""SELECT f.name,f.domain FROM lead_search_companies f
                JOIN lead_searches s ON s.id=f.search_id WHERE s.project_id=? AND s.id=?""",
                (project_id,item['search_id'])).fetchall()
            names = {' '.join(firm['name'].casefold().split()) for firm in firms}
            domains = {firm['domain'] for firm in firms}
            pool = project_scope.contact_pool(c,project_id)
            contacts = []
            for row in c.execute('SELECT id,name,email,company,research_data FROM contacts WHERE contact_pool=? ORDER BY name,id',(pool,)):
                company = ' '.join(row['company'].casefold().split())
                domain = json.loads(row['research_data']).get('domain') or (row['email'].rsplit('@',1)[-1] if not company else '')
                if company in names or str(domain).strip().lower().removeprefix('www.').rstrip('.') in domains:
                    contacts.append({key:row[key] for key in ('id','name','email','company')})
        return {'contacts':contacts}

    def add(self,item,*,from_dashboard=False):
        project=shared_project.get(self.db,item.get('project_id'))
        if from_dashboard and languages.data_simulation(self.db):
            raise ValueError('Wyłącz symulację, aby zapisać rzeczywiste kontakty.')
        if item.get('confirm_company') is not True:raise ValueError('Potwierdź, że znaleziona domena należy do właściwej firmy.')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if from_dashboard and project_scope.active(c) != project['id']:
                raise ValueError('Aktywny projekt zmienił się. Otwórz wynik ponownie.')
            if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project['id'],)).fetchone():raise ValueError('Projekt został usunięty.')
            search=c.execute('SELECT * FROM discover_contact_searches WHERE id=? AND project_id=?',(int(item['id']),project['id'])).fetchone()
            if not search:raise ValueError('Nie znaleziono wyników w tym projekcie.')
            if time.time()-search['created']>86400:raise ValueError('Wyniki są starsze niż 24 godziny. Wyszukaj kontakty ponownie.')
            contacts=json.loads(search['contacts']);selected=item.get('selected')
            if not isinstance(selected,list) or not selected or any(type(i)!=int or i<0 or i>=len(contacts) for i in selected):raise ValueError('Wybierz kontakty z wyników wyszukiwania.')
            group='';added=existing=0
            for index in dict.fromkeys(selected):
                person=contacts[index]
                tags=self.person_tags(c,item,person['email']);group='; '.join(tags)
                if from_dashboard and not tags:
                    raise ValueError('Dodaj co najmniej jeden tag.')
                pool=project_scope.contact_pool(c,project['id'])
                row=c.execute('SELECT id,research_data FROM contacts WHERE email=? AND contact_pool=?',(person['email'],pool)).fetchone()
                attributes=person.get('attributes') or contact_attributes(person,person['sources'],search['domain'])
                if row:
                    existing+=1
                    if group:contact_tags.set_tags(c,row['id'],tags,merge='tags' in item or 'tags_by_contact' in item,project_id=project['id'])
                    if from_dashboard:
                        data=merge_attributes(json.loads(row['research_data']),attributes)
                        c.execute("""UPDATE contacts SET research_data=?, name=CASE WHEN trim(name)='' THEN ? ELSE name END,
                            company=CASE WHEN trim(company)='' THEN ? ELSE company END,
                            role=CASE WHEN trim(role)='' THEN ? ELSE role END WHERE id=?""",
                                  (json.dumps(data,ensure_ascii=False),person['name'],search['company'],person['role'],row['id']))
                    continue
                notes=('Discover; email wymaga weryfikacji.\nDomena: '+search['domain']+'\nDowód zdarzenia: '+search['context']+'\nŹródła adresu:\n'+'\n'.join(source['url'] for source in person['sources']))[:10000]
                self.add_contact(c,{'project_id':project['id'],'name':person['name'],'email':person['email'],'company':search['company'],'role':person['role'],'notes':notes,'tags':tags});added+=1
                c.execute('UPDATE contacts SET research_data=? WHERE email=? AND contact_pool=?',
                          (json.dumps(attributes,ensure_ascii=False),person['email'],pool))
        return {'added':added,'existing':existing,'target_group':group}
