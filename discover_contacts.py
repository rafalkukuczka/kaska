"""Evidence-backed contact acquisition from Discover, with explicit grouped import."""
import json
import re
import time
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


class DiscoverContacts:
    def __init__(self,db,add_contact):self.db,self.add_contact=db,add_contact

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
            validated.append({**fields,'email':email})
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project['id'],)).fetchone():raise ValueError('Projekt został usunięty.')
            group='';added=existing=0
            for person in {p['email']:p for p in validated}.values():
                tags=self.person_tags(c,item,person['email']);group='; '.join(tags)
                if not group:raise ValueError('Dodaj co najmniej jeden tag każdemu zapisywanemu kontaktowi.')
                row=c.execute('SELECT id,simulated FROM contacts WHERE email=? AND contact_pool=?',(person['email'],project_scope.contact_pool(c,project['id']))).fetchone()
                if row:
                    existing+=1
                    if row['simulated']:contact_tags.set_tags(c,row['id'],tags,merge='tags' in item or 'tags_by_contact' in item,project_id=project['id'])
                    continue
                self.add_contact(c,{**person,'project_id':project['id'],'company':company,'tags':tags,'notes':'Dane symulacyjne. Projekt: '+project['name']+'. Wykluczone z rzeczywistej wysyłki.'})
                c.execute('UPDATE contacts SET simulated=1 WHERE email=? AND contact_pool=?',(person['email'],project_scope.contact_pool(c,project['id'])));added+=1
        return {'added':added,'existing':existing,'target_group':group,'simulated':True,'persisted':True}

    def search(self,item,*,researched_company=None):
        project=shared_project.get(self.db,item.get('project_id'))
        if languages.data_simulation(self.db):raise ValueError('Włączona jest symulacja pobierania. Rzeczywiste wyszukiwanie jest wyłączone.')
        company=item.get('company','')
        if not isinstance(company,str) or not company.strip() or len(company)>200:raise ValueError('Nieprawidłowa firma.')
        with self.db() as c:
            names=[row['company'] for row in c.execute('SELECT DISTINCT p.company FROM prospect_candidates p JOIN prospect_runs r ON r.id=p.run_id WHERE r.project_id=?',(project['id'],))]
            names.extend(row['company'] for row in c.execute('SELECT DISTINCT company FROM discovered_opportunities WHERE project_id=?',(project['id'],)))
            names.extend(row['company'] for row in c.execute('SELECT DISTINCT company FROM contacts WHERE contact_pool=?',(project_scope.contact_pool(c,project['id']),)))
            name=next((name for name in names if name.casefold()==company.strip().casefold()),None)
            firm=researched_company or ({'company':name,'quote':'Firma z wyników wyszukiwania lub Kontaktów.'} if name else None)
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
        domain=clean_domain(domain) if domain else ''
        params={'limit':limit,'type':'personal','provenance':'found','required_field':'full_name'}
        params.update({'domain':domain} if domain else {'company':firm['company']})
        if titles.strip():params['job_titles']=titles.strip()
        data=waterfall(Hunter(),domain,limit,titles.strip(),hunter_params=params)
        if not isinstance(data,dict) or not isinstance(data.get('emails',[]),list):raise ValueError('Hunter zwrócił nieprawidłową listę kontaktów.')
        found_domain=clean_domain(data['domain']) if data.get('domain') else domain
        if domain and found_domain!=domain:raise ValueError('Hunter zwrócił inną domenę. Wynik nie został zapisany.')
        organization=str(data.get('organization') or firm['company'])[:250];contacts=[];seen=set()
        for person in data.get('emails',[])[:limit]:
            if not isinstance(person,dict):continue
            email=str(person.get('value') or '').strip().lower()
            if not found_domain or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',email) or len(email)>254 or email.rsplit('@',1)[1]!=found_domain:continue
            if person.get('type')!='personal' or person.get('provenance') not in (None,'found'):continue
            name=' '.join(str(person.get(key) or '').strip() for key in ('first_name','last_name')).strip()[:250]
            raw_sources=person.get('sources') or []
            if not isinstance(raw_sources,list):continue
            sources=[{'url':safe_link(source.get('uri','')),'last_seen':str(source.get('last_seen_on') or '')[:100],
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
            row = c.execute("""SELECT f.name,f.domain FROM lead_search_companies f JOIN lead_searches s ON s.id=f.search_id
                WHERE s.id=? AND s.project_id=? AND f.domain=?""", (item['search_id'],project,domain)).fetchone()
            profile = c.execute('SELECT profile FROM lead_company_profiles WHERE project_id=? AND domain=?',
                                (project,domain)).fetchone()
            kinds = [r[0] for r in c.execute("""SELECT DISTINCT v.kind FROM lead_signals v
                JOIN lead_signal_subscriptions b ON b.run_id=v.run_id
                JOIN lead_signal_runs r ON r.id=b.run_id
                WHERE b.search_id=? AND r.domain=? AND v.source_date>=date('now','-30 days')""",
                                            (item['search_id'],domain))]
        if not row:
            raise ValueError('Nie znaleziono firmy w tym wyszukiwaniu i projekcie.')
        titles = lead_sources.contact_roles(json.loads(profile['profile']) if profile else {},kinds)
        request = {'project_id':project,'company':row['name'][:200],'domain':row['domain'],'limit':5,'titles':titles}
        firm = {'company':row['name'],'quote':'Firma z wyników Dashboardu · '+row['domain']}
        result = self.search(request,researched_company=firm)
        if titles and not result['contacts']:
            result = self.search({**request,'titles':''},researched_company=firm)
        return {**result,'suggested_roles':titles}

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
