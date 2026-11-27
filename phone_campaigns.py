"""Manual call queues and scripts for phone campaigns."""
import json
import re
import time

import campaign_edit
import contact_tags
from content_library import Library
import offer_documents
import phone_flows
import project_scope
import sequence_conditions


OUTCOMES = ('answered', 'no_answer')


def init_schema(connection):
    if 'phone_time_variant' not in {row[1] for row in connection.execute('PRAGMA table_info(steps)')}:
        connection.execute('ALTER TABLE steps ADD COLUMN phone_time_variant TEXT')
    connection.execute("""CREATE TABLE IF NOT EXISTS phone_campaign_calls (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        contact_id INTEGER NOT NULL REFERENCES contacts(id),
        position INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('answered','no_answer')),
        created REAL NOT NULL,
        PRIMARY KEY(campaign_id, contact_id, position))""")
    phone_flows.init_schema(connection)


def validate_time_variants(value, count):
    if not isinstance(value,list) or len(value)!=count:
        raise ValueError('Ustaw porę dnia osobno dla każdego kroku.')
    variants=[]
    for variant in value:
        if variant is None:
            variants.append(None)
            continue
        if not isinstance(variant,dict):
            raise ValueError('Podaj poprawny warunek pory dnia.')
        start,end=variant.get('start'),variant.get('end')
        if not all(isinstance(hour,str) and re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',hour)
                   for hour in (start,end)) or start==end:
            raise ValueError('Ustaw dwie różne godziny w warunku pory dnia.')
        otherwise=variant.get('otherwise')
        if not isinstance(otherwise,str) or not 1<=len(otherwise.strip())<=15000:
            raise ValueError('Wpisz tekst skryptu poza wybranymi godzinami.')
        variants.append({'start':start,'end':end,'otherwise':otherwise.strip()})
    return variants


def dial_number(value):
    if not isinstance(value, str) or len(value) > 45 or not re.fullmatch(r'\+?[0-9 ()./\-]+', value):
        return ''
    digits = re.sub(r'[^0-9]', '', value)
    if not 7 <= len(digits) <= 15:
        return ''
    if value.startswith('+'):
        return '+' + re.sub(r'[^0-9]', '', value.replace('(0)', '', 1))
    return digits


def require_campaign(connection, campaign_id):
    if type(campaign_id) is not int or not 0 < campaign_id < 2**63:
        raise ValueError('Nie znaleziono kampanii telefonicznej.')
    project_scope.require_campaign(connection, campaign_id)
    campaign = connection.execute("SELECT * FROM campaigns WHERE id=? AND channel='phone'", (campaign_id,)).fetchone()
    if not campaign:
        raise ValueError('Nie znaleziono kampanii telefonicznej.')
    return campaign


def audience(connection, item):
    mode, match = item.get('audience_mode'), item.get('tag_match', 'any')
    if mode not in ('all', 'tags') or match not in ('any', 'all'):
        raise ValueError('Wybierz odbiorców kampanii telefonicznej.')
    project = project_scope.active(connection)
    if item.get('project_id', project) != project:
        raise ValueError('Projekt się zmienił. Otwórz dialog ponownie.')
    tags = contact_tags.normalize(connection, item.get('audience_tags', []), project) if mode == 'tags' else []
    if mode == 'tags' and not tags:
        raise ValueError('Wybierz co najmniej jeden tag.')
    return project, mode, match, tags


def save_offer(connection, campaign_id, item, *, creating):
    limits = {'offer':10000,'audience':3000,'website':2000,'language':20,'cta':300,'cta_url':2000,
              'pain_points':10000,'value_props':10000,'proof_points':10000}
    if any(key in item for key in limits):
        previous=connection.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone()
        offer={key:item.get(key,previous[key]) for key in limits}
        if any(not isinstance(value,str) or len(value)>limits[key] for key,value in offer.items()):
            raise ValueError('Sprawdź długość opisu i pól oferty.')
        website,_,_,_,_,language,cta,cta_url,pains,values,proof=Library.validate_campaign(connection,offer)
        connection.execute("""UPDATE campaigns SET offer=?,audience=?,website=?,language=?,cta=?,cta_url=?,
            pain_points=?,value_props=?,proof_points=? WHERE id=?""",
            (offer['offer'].strip(),offer['audience'].strip(),website,language,cta,cta_url,pains,values,proof,campaign_id))
    offer_documents.save_campaign_settings(connection,project_scope.active(connection),campaign_id,item,creating=creating)


def save(connection, item):
    if 'flow' in item:
        return save_flow(connection,item)
    name, scripts = item.get('name'), item.get('scripts')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 200:
        raise ValueError('Podaj nazwę kampanii o długości do 200 znaków.')
    if not isinstance(scripts, list) or not 1 <= len(scripts) <= 6 or any(
            not isinstance(script, str) or not 1 <= len(script.strip()) <= 15000 for script in scripts):
        raise ValueError('Dodaj od 1 do 6 skryptów rozmów, po maksymalnie 15 000 znaków.')
    scripts = [script.strip() for script in scripts]
    project, mode, match, tags = audience(connection, item)
    campaign_id = item.get('id')
    creating=campaign_id is None
    existing = require_campaign(connection,campaign_id) if campaign_id is not None else None
    if existing is not None and phone_flows.versions(connection,campaign_id):
        raise ValueError('Otwórz edytor rozgałęzień, aby zapisać tę sekwencję.')
    old_variants = read_time_variants(connection,campaign_id) if existing is not None else []
    default_variants = old_variants if any(old_variants) else [None]*len(scripts)
    variants = validate_time_variants(item.get('time_variants',default_variants),len(scripts))
    old_conditions = json.loads(existing['conditions']) if existing is not None else []
    conditions = sequence_conditions.validate(item.get('conditions', old_conditions))
    if any(rule.get('before_step',0) > len(scripts) for rule in conditions):
        raise ValueError('Warunek musi wskazywać krok w sekwencji.')
    if campaign_id is None:
        campaign_id = connection.execute("""INSERT INTO campaigns
            (name,offer,audience,created,project_id,channel,status,audience_mode,audience_tags,tag_match,conditions)
            VALUES(?,'','',?,?,'phone','active',?,?,?,?)""",
            (name.strip(),time.time(),project,mode,json.dumps(tags,ensure_ascii=False),match,
             json.dumps(conditions,ensure_ascii=False))).lastrowid
    else:
        if connection.execute('SELECT 1 FROM phone_campaign_calls WHERE campaign_id=? LIMIT 1', (campaign_id,)).fetchone():
            if scripts != read_scripts(connection, campaign_id) or conditions != old_conditions or variants != old_variants:
                raise ValueError('Sekwencję można zmienić przed zapisaniem pierwszego wyniku rozmowy.')
        connection.execute("""UPDATE campaigns SET name=?,audience_mode=?,audience_tags=?,tag_match=?,
                           conditions=?,status='active',revision=revision+1 WHERE id=?""",
                           (name.strip(),mode,json.dumps(tags,ensure_ascii=False),match,
                            json.dumps(conditions,ensure_ascii=False),campaign_id))
    connection.execute('DELETE FROM steps WHERE campaign_id=?', (campaign_id,))
    connection.executemany("""INSERT INTO steps(campaign_id,position,delay_days,subject,body,phone_time_variant)
                           VALUES(?,?,0,'',?,?)""",
                           ((campaign_id,position,script,json.dumps(variant,ensure_ascii=False) if variant else None)
                            for position,(script,variant) in enumerate(zip(scripts,variants))))
    save_offer(connection,campaign_id,item,creating=creating)
    return {'id': campaign_id}


def save_flow(connection,item):
    name=item.get('name')
    if not isinstance(name,str) or not 1<=len(name.strip())<=200:
        raise ValueError('Podaj nazwę kampanii o długości do 200 znaków.')
    flow=phone_flows.validate(item['flow'],validate_time_variants)
    project,mode,match,tags=audience(connection,item)
    campaign_id=item.get('id')
    creating=campaign_id is None
    settings=(name.strip(),mode,json.dumps(tags,ensure_ascii=False),match)
    latest=None
    latest_id=None
    if campaign_id is None:
        campaign_id=connection.execute("""INSERT INTO campaigns
            (name,audience_mode,audience_tags,tag_match,offer,audience,project_id,created,channel,status)
            VALUES(?,?,?,?,'','',?,?,'phone','active')""",(*settings,project,time.time())).lastrowid
    else:
        campaign=require_campaign(connection,campaign_id)
        if item.get('revision',campaign['revision'])!=campaign['revision']:
            raise ValueError('Kampania zmieniła się. Otwórz ją ponownie.')
        stored=phone_flows.versions(connection,campaign_id)
        if stored:
            latest_id=next(reversed(stored))
            latest=stored[latest_id]
        elif connection.execute('SELECT 1 FROM phone_campaign_calls WHERE campaign_id=? LIMIT 1',(campaign_id,)).fetchone():
            frozen=phone_flows.legacy(read_scripts(connection,campaign_id),read_time_variants(connection,campaign_id),
                                      json.loads(campaign['conditions']))
            frozen_id=phone_flows.store(connection,campaign_id,frozen)
            connection.execute('UPDATE phone_campaign_calls SET flow_id=? WHERE campaign_id=?',(frozen_id,campaign_id))
        connection.execute("""UPDATE campaigns SET name=?,audience_mode=?,audience_tags=?,tag_match=?,
            conditions='[]',status='active',revision=revision+1 WHERE id=?""",(*settings,campaign_id))
    if flow!=latest:
        if latest and flow['entry']==latest['entry'] and flow['nodes']==latest['nodes']:
            connection.execute('UPDATE phone_campaign_flows SET definition=? WHERE id=?',
                               (json.dumps(flow,ensure_ascii=False),latest_id))
        else:
            phone_flows.store(connection,campaign_id,flow)
    save_offer(connection,campaign_id,item,creating=creating)
    return {'id':campaign_id}


def read_scripts(connection, campaign_id):
    return [row['body'] for row in connection.execute(
        'SELECT body FROM steps WHERE campaign_id=? ORDER BY position', (campaign_id,))]


def read_time_variants(connection, campaign_id):
    return [json.loads(row[0]) if row[0] else None for row in connection.execute(
        'SELECT phone_time_variant FROM steps WHERE campaign_id=? ORDER BY position',(campaign_id,))]


def recipients(connection, campaign):
    people = []
    for contact in campaign_edit.recipients(connection, campaign):
        phone = json.loads(contact['research_data']).get('work_phone', '')
        dial = dial_number(phone)
        if dial:
            people.append(({key:contact[key] for key in ('id','name','company')} |
                           {'phone':phone,'dial':dial},contact))
    return sorted(people,key=lambda pair:(pair[0]['name'].casefold(),pair[0]['id']))


def preview_recipients(connection, item):
    project, mode, match, tags = audience(connection, item)
    if item.get('id') is not None:
        require_campaign(connection, item['id'])
    campaign = {'id':item.get('id'),'project_id':project,'audience_mode':mode,'tag_match':match,
                'audience_tags':json.dumps(tags),'conditions':sequence_conditions.validate(item.get('conditions',[]))}
    flow=phone_flows.validate(item['flow'],validate_time_variants,draft=True) if 'flow' in item else None
    timestamp=time.time()
    return {'recipients':[person for person,contact in recipients(connection,campaign)
                          if flow is None or phone_flows.route(flow,contact,timestamp=timestamp) is not None]}


def queue(connection, campaign, scripts, calls):
    if campaign['status'] != 'active':
        return []
    progress = {}
    for call in calls:
        previous = progress.get(call['contact_id'], 0)
        progress[call['contact_id']] = len(scripts) if call['outcome'] == 'answered' else max(previous, call['position'] + 1)
    people = []
    conditions = json.loads(campaign['conditions'])
    for person,contact in recipients(connection,campaign):
        position = progress.get(person['id'],0)
        if position < len(scripts) and sequence_conditions.matches(conditions,contact,position,position-1):
            people.append(person | {'position':position})
    return people


def flow_queue(connection,campaign,versions,calls):
    if campaign['status']!='active':
        return []
    latest=next(reversed(versions))
    previous={}
    for call in calls:
        previous.setdefault(call['contact_id'],call)
    people=[]
    timestamp=time.time()
    for person,contact in recipients(connection,campaign):
        last=previous.get(person['id'])
        flow_id=last['flow_id'] if last else latest
        step=phone_flows.route(versions[flow_id],contact,last,timestamp=timestamp)
        if step:
            people.append(person | step | {'flow_id':flow_id})
    return people


def read(connection, campaign_id):
    campaign = require_campaign(connection, campaign_id)
    scripts = read_scripts(connection, campaign_id)
    calls = [dict(row) for row in connection.execute("""SELECT a.contact_id,a.position,a.outcome,a.created,a.flow_id,t.name,t.company
        FROM phone_campaign_calls a JOIN contacts t ON t.id=a.contact_id
        WHERE a.campaign_id=? ORDER BY a.created DESC,a.rowid DESC""", (campaign_id,))]
    versions=phone_flows.versions(connection,campaign_id)
    current=next(reversed(versions.values())) if versions else None
    return {'scripts': scripts, 'time_variants':read_time_variants(connection,campaign_id),
            'conditions': json.loads(campaign['conditions']),
            'flow':current,'queue':flow_queue(connection,campaign,versions,calls) if current else queue(connection,campaign,scripts,calls),
            'calls': calls,
            'revision': campaign['revision'], 'paused': campaign['status'] == 'paused'}


def record(connection, item):
    campaign_id, contact_id = item.get('id'), item.get('contact_id')
    position, outcome = item.get('position'), item.get('outcome')
    if type(campaign_id) is not int or type(contact_id) is not int or type(position) is not int or outcome not in OUTCOMES:
        raise ValueError('Wybierz poprawny wynik rozmowy.')
    campaign = require_campaign(connection, campaign_id)
    if item.get('project_id', campaign['project_id']) != campaign['project_id']:
        raise ValueError('Projekt się zmienił. Otwórz kampanię ponownie.')
    existing = connection.execute("""SELECT outcome,flow_id FROM phone_campaign_calls
        WHERE campaign_id=? AND contact_id=? AND position=?""", (campaign_id,contact_id,position)).fetchone()
    if existing and existing['outcome'] == outcome and existing['flow_id']==item.get('flow_id'):
        return {'ok': True}
    scripts = read_scripts(connection, campaign_id)
    calls = connection.execute("""SELECT * FROM phone_campaign_calls WHERE campaign_id=? AND contact_id=?
                               ORDER BY created DESC,rowid DESC""",
                               (campaign_id,contact_id)).fetchall()
    versions=phone_flows.versions(connection,campaign_id)
    pending=flow_queue(connection,campaign,versions,calls) if versions else queue(connection,campaign,scripts,calls)
    if existing or item.get('revision',campaign['revision']) != campaign['revision'] or not any(
                           row['id']==contact_id and row['position']==position and row.get('flow_id')==item.get('flow_id')
                           for row in pending):
        raise ValueError('Kontakt lub skrypt zmienił się. Odśwież kolejkę.')
    now = time.time()
    connection.execute('INSERT INTO phone_campaign_calls(campaign_id,contact_id,position,outcome,created,flow_id) VALUES(?,?,?,?,?,?)',
                       (campaign_id,contact_id,position,outcome,now,item.get('flow_id')))
    connection.execute('INSERT INTO events(created,detail) VALUES(?,?)',
                       (now,'Zapisano wynik rozmowy w kampanii '+campaign['name']))
    return {'ok': True}
