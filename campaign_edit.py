"""Edit campaign configuration without rewriting delivery history."""
import json
import time

import contact_groups
import contact_tags
import project_scope
import sequence_conditions
import manual_interaction
import offer_documents

REMOVED_RECIPIENT_REASON = 'Usunięto odbiorcę z kampanii.'


def init_schema(c):
    if 'revision' not in {row[1] for row in c.execute('PRAGMA table_info(campaigns)')}:
        c.execute('ALTER TABLE campaigns ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
    c.execute("""CREATE TABLE IF NOT EXISTS campaign_recipient_overrides(
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        contact_id INTEGER NOT NULL REFERENCES contacts(id),
        included INTEGER NOT NULL CHECK(included IN (0,1)),
        PRIMARY KEY(campaign_id,contact_id))""")


def recipients(c,campaign):
    rows=c.execute("SELECT * FROM contacts WHERE status='active' AND simulated=0 AND contact_pool=?",(project_scope.contact_pool(c,campaign['project_id']),)).fetchall()
    overrides=dict(c.execute('SELECT contact_id,included FROM campaign_recipient_overrides WHERE campaign_id=?',(campaign['id'],)).fetchall())
    mode=campaign['audience_mode']
    if mode not in ('all','selected','group','tags'):return []
    selected=set(json.loads(campaign['contact_ids'])) if mode=='selected' else set()
    audience={
        'all':lambda row:True,
        'selected':lambda row:row['id'] in selected,
        'group':lambda row:campaign['target_group'] and row['target_group']==campaign['target_group'],
        'tags':lambda row:contact_tags.matches(row['tags'],campaign['audience_tags'],campaign['tag_match']),
    }[mode]
    return [row for row in rows if (overrides[row['id']] if row['id'] in overrides else audience(row))
            and sequence_conditions.matches(campaign['conditions'],row,0)]


def change_recipient(db,item,include):
    campaign_id,contact_id=item.get('id'),item.get('contact_id')
    if type(campaign_id)!=int or type(contact_id)!=int:
        raise ValueError('Wybierz kampanię i kontakt.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        project_scope.require_campaign(c,campaign_id)
        campaign=c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone()
        if item.get('project_id',campaign['project_id'])!=campaign['project_id']:
            raise ValueError('Zmieniono projekt. Otwórz kampanię ponownie.')
        project_scope.require_contact(c,contact_id,campaign['project_id'])
        contact=c.execute('SELECT * FROM contacts WHERE id=?',(contact_id,)).fetchone()
        override=c.execute('SELECT included FROM campaign_recipient_overrides WHERE campaign_id=? AND contact_id=?',
                           (campaign_id,contact_id)).fetchone()
        if not include and override and not override[0]:
            return {'ok':True}
        selected=any(row['id']==contact_id for row in recipients(c,campaign))
        prepared=c.execute('SELECT 1 FROM messages WHERE campaign_id=? AND contact_id=? AND deleted=0 LIMIT 1',
                           (campaign_id,contact_id)).fetchone()
        enrolled=(selected or prepared) and (not override or override[0])
        if include:
            if enrolled or (override and override[0]):
                raise ValueError('Ten kontakt jest już w kampanii.')
            if contact['status']!='active' or contact['simulated'] or not sequence_conditions.matches(campaign['conditions'],contact,0):
                raise ValueError('Kontakt musi być aktywny i spełniać warunki sekwencji.')
        elif not enrolled:
            raise ValueError('Nie znaleziono tego odbiorcy w kampanii.')
        c.execute("""INSERT INTO campaign_recipient_overrides VALUES(?,?,?)
            ON CONFLICT(campaign_id,contact_id) DO UPDATE SET included=excluded.included""",
                  (campaign_id,contact_id,int(include)))
        if not include:
            c.execute("""UPDATE messages SET status='cancelled',deleted=1,error=?
                WHERE campaign_id=? AND contact_id=? AND status='queued' AND deleted=0""",
                      (REMOVED_RECIPIENT_REASON,campaign_id,contact_id))
        c.execute('UPDATE campaigns SET revision=revision+1 WHERE id=?',(campaign_id,))
    return {'ok':True}


def recipient_options(db,campaign_id,query):
    with db() as c:
        project_scope.require_campaign(c,campaign_id)
        pool=project_scope.contact_pool(c,project_scope.active(c))
        return [dict(row) for row in c.execute("""SELECT id,name,email,company FROM contacts
            WHERE contact_pool=? AND status='active' AND simulated=0
            AND instr(company_key(name||' '||email||' '||company),company_key(?))>0
            ORDER BY name COLLATE NOCASE,id LIMIT 40""",(pool,query.strip()[:200]))]


def read(db,campaign_id):
    with db() as c:
        return _read(c,campaign_id)


def _has_queued_messages(c, campaign_id):
    return c.execute("""SELECT 1 FROM messages WHERE campaign_id=? AND status='queued'
        AND deleted=0 LIMIT 1""", (campaign_id,)).fetchone() is not None


def _read(c,campaign_id):
    project_scope.require_campaign(c,campaign_id)
    campaign=dict(c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone())
    steps=[dict(row) for row in c.execute('SELECT * FROM steps WHERE campaign_id=? ORDER BY position',(campaign_id,))]
    protected=c.execute("SELECT MAX(position) FROM messages WHERE campaign_id=? AND (sent_at IS NOT NULL OR status IN ('sent','sending','uncertain'))",(campaign_id,)).fetchone()[0]
    selected=set(json.loads(campaign['contact_ids']))
    contacts=[dict(row) for row in c.execute('SELECT id,name,email,company,role,status,simulated FROM contacts WHERE contact_pool=?',(project_scope.contact_pool(c,campaign['project_id']),)) if row['id'] in selected]
    return {'campaign':campaign,'steps':steps,'protected_position':protected,'selected_contacts':contacts,
            'has_queued_messages':_has_queued_messages(c,campaign_id)}


def restart_messages(c, campaign, eligible, steps, messages):
    if campaign['channel'] == 'manual' or not messages:
        return []
    if any(row['status'] in ('queued','sending','uncertain') for row in messages):
        return []
    if c.execute('SELECT 1 FROM discovery_handoffs WHERE campaign_id=?', (campaign['id'],)).fetchone():
        return []
    contacts = {row['id']: row for row in eligible}
    delays = {row['position']: row['delay_days'] for row in steps}
    next_step = {}
    prepared = []
    for row in sorted(messages, key=lambda row: row['position']):
        person = contacts.get(row['contact_id'])
        position = row['position']
        if not person or position != next_step.get(person['id'], 0) or position not in delays:
            continue
        if row['status'] == 'cancelled' and row['error']:
            continue
        if not sequence_conditions.matches(campaign['conditions'], person, position, position-1):
            continue
        prepared.append((person['id'], position, row['subject'], row['body'], delays[position]))
        next_step[person['id']] = position + 1
    return prepared


def clone(db, item, *, restart=False):
    campaign_id = int(item['id'])
    fields = ('offer','audience','project_id','website','audience_mode','contact_ids','material_mode','material_ids',
              'language','cta','cta_url','pain_points','value_props','proof_points','conditions','target_group',
              'audience_tags','tag_match','channel','manual_scenarios','offer_website','offer_sources','attachment_ref')
    columns = ','.join(fields)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        project_id = project_scope.active(c)
        project_scope.require_campaign(c,campaign_id,project_id)
        if item.get('project_id',project_id)!=project_id:
            raise ValueError('Zmieniono projekt. Otwórz kampanię ponownie.')
        source = c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone()
        prepared = []
        if restart:
            steps = c.execute('SELECT position,delay_days FROM steps WHERE campaign_id=?', (campaign_id,)).fetchall()
            messages = c.execute('SELECT * FROM messages WHERE campaign_id=? AND deleted=0', (campaign_id,)).fetchall()
            prepared = restart_messages(c, source, recipients(c, source), steps, messages)
            if not prepared:
                raise ValueError('Brak przygotowanych wiadomości do ponownego uruchomienia.')
        requested_name = item.get('name')
        if requested_name is not None and (not isinstance(requested_name,str) or not requested_name.strip() or len(requested_name.strip())>200):
            raise ValueError('Podaj nazwę kampanii o długości do 200 znaków.')
        base = requested_name.strip() if requested_name is not None else (
            ('Ponownie: ' + source['name'])[:200] if restart else 'Kopia ' + source['name'])
        names = {row[0].casefold() for row in c.execute("SELECT name FROM campaigns WHERE project_id=? AND status!='deleted'",(project_id,))}
        name, sequence = base, 2
        while name.casefold() in names:
            name = f'{base} ({sequence})'
            sequence += 1
        now = time.time()
        copy_id = c.execute(f"""INSERT INTO campaigns(name,status,created,{columns})
            SELECT ?,'draft',?,{columns} FROM campaigns WHERE id=?""",(name,now,campaign_id)).lastrowid
        c.execute("""INSERT INTO steps(campaign_id,position,delay_days,subject,body,phone_time_variant)
            SELECT ?,position,delay_days,subject,body,phone_time_variant FROM steps WHERE campaign_id=? ORDER BY position""",(copy_id,campaign_id))
        if source['channel']=='phone':
            c.execute("""INSERT INTO phone_campaign_flows(campaign_id,definition)
                SELECT ?,definition FROM phone_campaign_flows WHERE campaign_id=? ORDER BY id DESC LIMIT 1""",
                (copy_id,campaign_id))
        if restart:
            contacts = sorted({row[0] for row in prepared})
            c.execute("UPDATE campaigns SET audience_mode='selected',contact_ids=? WHERE id=?",
                      (json.dumps(contacts),copy_id))
        else:
            c.execute("""INSERT INTO campaign_recipient_overrides(campaign_id,contact_id,included)
                SELECT ?,contact_id,included FROM campaign_recipient_overrides WHERE campaign_id=?""",(copy_id,campaign_id))
        c.execute("""INSERT INTO campaign_offer_documents(project_id,scope,name,digest,text,original)
            SELECT project_id,?,name,digest,text,original FROM campaign_offer_documents WHERE project_id=? AND scope=? ORDER BY id""",
            (f'campaign:{copy_id}',project_id,f'campaign:{campaign_id}'))
        if restart:
            c.executemany("""INSERT INTO messages(campaign_id,contact_id,position,subject,body,due)
                VALUES(?,?,?,?,?,?)""", ((copy_id, contact_id, position, subject, body, now+delay*86400)
                                         for contact_id, position, subject, body, delay in prepared))
        detail = ('Przygotowano ponowne uruchomienie kampanii: ' if restart else 'Sklonowano kampanię: ') + name
        c.execute('INSERT INTO events(created,detail) VALUES(?,?)',(now,detail))
        return _read(c,copy_id)


def save(db,library,mail_lock,ai_copy,item):
    if not isinstance(item.get('name'),str) or not item['name'].strip() or not isinstance(item.get('offer'),str) or not item['offer'].strip():raise ValueError('Podaj nazwę i ofertę')
    conditions=sequence_conditions.validate(item.get('conditions',[]))
    steps=item.get('steps')
    if not isinstance(steps,list) or not 1<=len(steps)<=6:raise ValueError('Dodaj od 1 do 6 kroków')
    previous=-1;validated=[]
    for position,step in enumerate(steps):
        delay=int(step['delay_days'])
        if not 0<=delay<=365 or delay<=previous or not isinstance(step.get('subject'),str) or not step['subject'].strip() or '\n' in step['subject'] or '\r' in step['subject'] or not isinstance(step.get('body'),str) or not step['body'].strip():raise ValueError('Kroki muszą mieć temat, treść i rosnącą liczbę dni')
        validated.append({'position':position,'delay_days':delay,'subject':step['subject'],'body':step['body']});previous=delay
    with mail_lock,db() as c:
        c.execute('BEGIN IMMEDIATE');project_scope.require_campaign(c,item['id'])
        current=dict(c.execute('SELECT * FROM campaigns WHERE id=?',(item['id'],)).fetchone())
        if current['channel'] == 'phone':
            raise ValueError('Skrypty kampanii telefonicznej ustawisz w sekwencji rozmów.')
        if item.get('project_id',current['project_id'])!=current['project_id']:raise ValueError('Zmieniono projekt. Otwórz kampanię ponownie.')
        if type(item.get('revision'))!=int or item['revision']!=current['revision']:raise ValueError('Kampania została zmieniona w innym oknie. Otwórz edycję ponownie.')
        for contact_id in item.get('contact_ids',[]):project_scope.require_contact(c,contact_id,current['project_id'])
        old_steps={row['position']:dict(row) for row in c.execute('SELECT * FROM steps WHERE campaign_id=?',(item['id'],))}
        protected=c.execute("SELECT MAX(position) FROM messages WHERE campaign_id=? AND (sent_at IS NOT NULL OR status IN ('sent','sending','uncertain'))",(item['id'],)).fetchone()[0]
        if protected is not None:
            for position in range(protected+1):
                if position>=len(validated) or position not in old_steps or any(validated[position][key]!=old_steps[position][key] for key in ('delay_days','subject','body')):raise ValueError('Nie można zmienić ani usunąć wysłanego kroku. Edytuj kolejne kroki sekwencji.')
        item={'language':current['language'],**item}
        extra=library.validate_campaign(c,item);group=contact_groups.campaign_group(c,item);tags,match=contact_tags.validate_campaign(c,item)
        status='paused' if current['status']!='draft' or protected is not None else 'draft'
        c.execute('UPDATE campaigns SET name=?,offer=?,audience=?,status=?,revision=revision+1 WHERE id=?',(item['name'].strip(),item['offer'].strip(),str(item.get('audience','')),status,item['id']))
        offer_documents.save_campaign_settings(c, current['project_id'], item['id'], item)
        c.execute('UPDATE campaigns SET website=?,audience_mode=?,contact_ids=?,material_mode=?,material_ids=?,language=?,cta=?,cta_url=?,pain_points=?,value_props=?,proof_points=? WHERE id=?',extra+(item['id'],))
        channel=item.get('channel',current.get('channel','email'))
        if channel not in ('email','linkedin','manual'):raise ValueError('Nieprawidłowy kanał kampanii')
        offer_documents.save_attachment(c, current['project_id'], item['id'], item, channel)
        scenarios=manual_interaction.validate_scenarios(item.get('manual_scenarios',current.get('manual_scenarios','[]')))
        if channel=='manual' and not scenarios:raise ValueError('Dodaj co najmniej jeden scenariusz Manual interaction.')
        old_channel=current.get('channel','email')
        if channel!=old_channel:
            if channel=='manual':
                if c.execute("SELECT 1 FROM messages WHERE campaign_id=? AND status IN ('sending','uncertain') LIMIT 1",(item['id'],)).fetchone():
                    raise ValueError('Przed przejściem na Manual interaction sprawdź wiadomości w trakcie wysyłki lub z niepotwierdzoną wysyłką.')
            elif c.execute('SELECT 1 FROM messages WHERE campaign_id=? LIMIT 1',(item['id'],)).fetchone():
                raise ValueError('Nie można zmienić kanału kampanii po przygotowaniu wiadomości.')
        c.execute('UPDATE campaigns SET conditions=?,target_group=?,audience_tags=?,tag_match=?,channel=?,manual_scenarios=? WHERE id=?',(json.dumps(conditions),group,json.dumps(tags),match,channel,json.dumps(scenarios,ensure_ascii=False),item['id']))
        c.execute('DELETE FROM steps WHERE campaign_id=?',(item['id'],))
        c.executemany('INSERT INTO steps(campaign_id,position,delay_days,subject,body) VALUES(?,?,?,?,?)',[(item['id'],step['position'],step['delay_days'],step['subject'],step['body']) for step in validated])
        updated=dict(c.execute('SELECT * FROM campaigns WHERE id=?',(item['id'],)).fetchone())
        material_changed = (current['material_mode'] in ('auto','manual') or updated['material_mode'] in ('auto','manual')) and current['material_mode']!=updated['material_mode']
        if status=='draft':
            draft_fields = ('offer','audience','website','language','cta','cta_url','material_ids',
                            'pain_points','value_props','proof_points','conditions','audience_mode','contact_ids',
                            'target_group','audience_tags','tag_match','channel')
            steps_changed = len(validated)!=len(old_steps) or any(
                any(value!=old_steps.get(step['position'],{}).get(key) for key,value in step.items())
                for step in validated)
            if steps_changed or material_changed or any(updated[key]!=current[key] for key in draft_fields):
                c.execute("DELETE FROM messages WHERE campaign_id=? AND sent_at IS NULL AND status NOT IN ('sent','sending','uncertain')",(item['id'],))
        else:
            contacts={row['id']:row for row in recipients(c,updated)}
            for message in c.execute("SELECT * FROM messages WHERE campaign_id=? AND status='queued' AND deleted=0",(item['id'],)).fetchall():
                contact=contacts.get(message['contact_id']);position=message['position']
                if not contact or position>=len(validated):
                    c.execute("UPDATE messages SET status='cancelled',error='Pominięto po zmianie odbiorców lub sekwencji kampanii.' WHERE id=?",(message['id'],));continue
                step=validated[position]
                changed=material_changed or any(updated[key]!=current[key] for key in ('offer','website','language','cta','cta_url','material_ids','pain_points','value_props','proof_points')) or any(step[key]!=old_steps.get(position,{}).get(key) for key in ('subject','body'))
                if changed:
                    subject,body=ai_copy(contact,updated,step,use_ai=False)
                    c.execute('UPDATE messages SET subject=?,body=? WHERE id=?',(subject,body,message['id']))
                first=c.execute('SELECT due,sent_at FROM messages WHERE campaign_id=? AND contact_id=? AND position=0',(item['id'],message['contact_id'])).fetchone()
                if step['delay_days']!=old_steps.get(position,{}).get('delay_days') and first:
                    baseline=(first['sent_at'] or first['due'])-old_steps.get(0,{}).get('delay_days',0)*86400
                    c.execute('UPDATE messages SET due=? WHERE id=?',(baseline+step['delay_days']*86400,message['id']))
        c.execute('INSERT INTO events(created,detail) VALUES(?,?)',(time.time(),'Zapisano zmiany kampanii: '+updated['name']))
        has_queued_messages = _has_queued_messages(c, item['id'])
    return {'ok':True,'id':item['id'],'status':status,'revision':updated['revision'],'has_queued_messages':has_queued_messages}
