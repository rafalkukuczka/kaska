"""Edit campaign configuration without rewriting delivery history."""
import json
import time

import contact_groups
import contact_tags
import project_scope
import sequence_conditions


def init_schema(c):
    if 'revision' not in {row[1] for row in c.execute('PRAGMA table_info(campaigns)')}:
        c.execute('ALTER TABLE campaigns ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')


def recipients(c,campaign):
    rows=c.execute("SELECT * FROM contacts WHERE status='active' AND simulated=0 AND contact_pool=?",(project_scope.contact_pool(c,campaign['project_id']),)).fetchall()
    mode=campaign['audience_mode']
    if mode not in ('all','selected','group','tags'):return []
    if mode=='selected':rows=[row for row in rows if row['id'] in json.loads(campaign['contact_ids'])]
    if mode=='group':rows=[row for row in rows if campaign['target_group'] and row['target_group']==campaign['target_group']]
    if mode=='tags':rows=[row for row in rows if contact_tags.matches(row['tags'],campaign['audience_tags'],campaign['tag_match'])]
    return [row for row in rows if sequence_conditions.matches(campaign['conditions'],row,0)]


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
        extra=library.validate_campaign(c,item);group=contact_groups.campaign_group(c,item);tags,match=contact_tags.validate_campaign(c,item)
        status='paused' if current['status']!='draft' or protected is not None else 'draft'
        c.execute('UPDATE campaigns SET name=?,offer=?,audience=?,status=?,revision=revision+1 WHERE id=?',(item['name'].strip(),item['offer'].strip(),str(item.get('audience','')),status,item['id']))
        c.execute('UPDATE campaigns SET website=?,audience_mode=?,contact_ids=?,material_mode=?,material_ids=?,language=?,cta=?,cta_url=?,pain_points=?,value_props=?,proof_points=? WHERE id=?',extra+(item['id'],))
        c.execute('UPDATE campaigns SET conditions=?,target_group=?,audience_tags=?,tag_match=? WHERE id=?',(json.dumps(conditions),group,json.dumps(tags),match,item['id']))
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
