"""Manual call queues and scripts for phone campaigns."""
import json
import re
import time

import campaign_edit
import contact_tags
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


def save(connection, item):
    name, scripts = item.get('name'), item.get('scripts')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 200:
        raise ValueError('Podaj nazwę kampanii o długości do 200 znaków.')
    if not isinstance(scripts, list) or not 1 <= len(scripts) <= 6 or any(
            not isinstance(script, str) or not 1 <= len(script.strip()) <= 15000 for script in scripts):
        raise ValueError('Dodaj od 1 do 6 skryptów rozmów, po maksymalnie 15 000 znaków.')
    scripts = [script.strip() for script in scripts]
    project, mode, match, tags = audience(connection, item)
    campaign_id = item.get('id')
    existing = require_campaign(connection,campaign_id) if campaign_id is not None else None
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
    return {'id': campaign_id}


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
    return {'recipients':[person for person,_ in recipients(connection,campaign)]}


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


def read(connection, campaign_id):
    campaign = require_campaign(connection, campaign_id)
    scripts = read_scripts(connection, campaign_id)
    calls = [dict(row) for row in connection.execute("""SELECT a.contact_id,a.position,a.outcome,a.created,t.name,t.company
        FROM phone_campaign_calls a JOIN contacts t ON t.id=a.contact_id
        WHERE a.campaign_id=? ORDER BY a.created DESC,a.contact_id,a.position DESC""", (campaign_id,))]
    return {'scripts': scripts, 'time_variants':read_time_variants(connection,campaign_id),
            'conditions': json.loads(campaign['conditions']),
            'queue': queue(connection,campaign,scripts,calls), 'calls': calls,
            'revision': campaign['revision'], 'paused': campaign['status'] == 'paused'}


def record(connection, item):
    campaign_id, contact_id = item.get('id'), item.get('contact_id')
    position, outcome = item.get('position'), item.get('outcome')
    if type(campaign_id) is not int or type(contact_id) is not int or type(position) is not int or outcome not in OUTCOMES:
        raise ValueError('Wybierz poprawny wynik rozmowy.')
    campaign = require_campaign(connection, campaign_id)
    if item.get('project_id', campaign['project_id']) != campaign['project_id']:
        raise ValueError('Projekt się zmienił. Otwórz kampanię ponownie.')
    existing = connection.execute("""SELECT outcome FROM phone_campaign_calls
        WHERE campaign_id=? AND contact_id=? AND position=?""", (campaign_id,contact_id,position)).fetchone()
    if existing and existing['outcome'] == outcome:
        return {'ok': True}
    scripts = read_scripts(connection, campaign_id)
    calls = connection.execute("SELECT * FROM phone_campaign_calls WHERE campaign_id=? AND contact_id=?",
                               (campaign_id,contact_id)).fetchall()
    if existing or item.get('revision',campaign['revision']) != campaign['revision'] or not any(
                           row['id'] == contact_id and row['position'] == position
                           for row in queue(connection,campaign,scripts,calls)):
        raise ValueError('Kontakt lub skrypt zmienił się. Odśwież kolejkę.')
    now = time.time()
    connection.execute('INSERT INTO phone_campaign_calls VALUES(?,?,?,?,?)', (campaign_id,contact_id,position,outcome,now))
    connection.execute('INSERT INTO events(created,detail) VALUES(?,?)',
                       (now,'Zapisano wynik rozmowy w kampanii '+campaign['name']))
    return {'ok': True}
