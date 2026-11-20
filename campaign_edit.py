"""Edit campaign configuration without rewriting delivery history."""
import json
import time

import contact_groups
import contact_tags
import project_scope
import sequence_conditions
import manual_interaction

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
        project_scope.require_campaign(c,campaign_id)
        campaign=dict(c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone())
        steps=[dict(row) for row in c.execute('SELECT * FROM steps WHERE campaign_id=? ORDER BY position',(campaign_id,))]
        protected=c.execute("SELECT MAX(position) FROM messages WHERE campaign_id=? AND (sent_at IS NOT NULL OR status IN ('sent','sending','uncertain'))",(campaign_id,)).fetchone()[0]
        selected=set(json.loads(campaign['contact_ids']))
        contacts=[dict(row) for row in c.execute('SELECT id,name,email,company,role,status,simulated FROM contacts WHERE contact_pool=?',(project_scope.contact_pool(c,campaign['project_id']),)) if row['id'] in selected]
    return {'campaign':campaign,'steps':steps,'protected_position':protected,'selected_contacts':contacts}


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
        c.execute('UPDATE campaigns SET website=?,audience_mode=?,contact_ids=?,material_mode=?,material_ids=?,language=?,cta=?,cta_url=?,pain_points=?,value_props=?,proof_points=? WHERE id=?',extra+(item['id'],))
        channel=item.get('channel',current.get('channel','email'))
        if channel not in ('email','linkedin','manual'):raise ValueError('Nieprawidłowy kanał kampanii')
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
        if status=='draft':
            c.execute("DELETE FROM messages WHERE campaign_id=? AND sent_at IS NULL AND status NOT IN ('sent','sending','uncertain')",(item['id'],))
        else:
            contacts={row['id']:row for row in recipients(c,updated)}
            for message in c.execute("SELECT * FROM messages WHERE campaign_id=? AND status='queued' AND deleted=0",(item['id'],)).fetchall():
                contact=contacts.get(message['contact_id']);position=message['position']
                if not contact or position>=len(validated):
                    c.execute("UPDATE messages SET status='cancelled',error='Pominięto po zmianie odbiorców lub sekwencji kampanii.' WHERE id=?",(message['id'],));continue
                step=validated[position]
                changed=any(updated[key]!=current[key] for key in ('offer','website','language','cta','cta_url','material_mode','material_ids','pain_points','value_props','proof_points')) or any(step[key]!=old_steps.get(position,{}).get(key) for key in ('subject','body'))
                if changed:
                    subject,body=ai_copy(contact,updated,step,use_ai=False)
                    c.execute('UPDATE messages SET subject=?,body=? WHERE id=?',(subject,body,message['id']))
                first=c.execute('SELECT due,sent_at FROM messages WHERE campaign_id=? AND contact_id=? AND position=0',(item['id'],message['contact_id'])).fetchone()
                if step['delay_days']!=old_steps.get(position,{}).get('delay_days') and first:
                    baseline=(first['sent_at'] or first['due'])-old_steps.get(0,{}).get('delay_days',0)*86400
                    c.execute('UPDATE messages SET due=? WHERE id=?',(baseline+step['delay_days']*86400,message['id']))
        c.execute('INSERT INTO events(created,detail) VALUES(?,?)',(time.time(),'Zapisano zmiany kampanii: '+updated['name']))
    return {'ok':True,'id':item['id'],'status':status,'revision':updated['revision']}
