"""Campaign overview and one paginated record per recipient."""
import hashlib
import json
import math

import campaign_edit
import project_scope


def init_schema(c):
    if 'campaign_id' not in {row[1] for row in c.execute('PRAGMA table_info(replies)')}:
        c.execute('ALTER TABLE replies ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id)')
    c.execute('CREATE INDEX IF NOT EXISTS reply_campaign ON replies(campaign_id)')


def read(db,campaign_id,page=1,size=25):
    campaign_id=int(campaign_id);page=int(page);size=int(size)
    if page<1 or size not in (10,25,50,100):raise ValueError('Nieprawidłowa strona odbiorców.')
    with db() as c:
        project_scope.require_campaign(c,campaign_id)
        campaign=dict(c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone())
        steps=[dict(row) for row in c.execute('SELECT * FROM steps WHERE campaign_id=? ORDER BY position',(campaign_id,))]
        ruled=campaign['audience_mode']=='signals' or bool(c.execute('SELECT 1 FROM signal_rules WHERE campaign_id=?',(campaign_id,)).fetchone())
        eligible=[] if ruled else campaign_edit.recipients(c,campaign)
        targets={row['id']:dict(row) for row in eligible}
        counts={row['status']:row['count'] for row in c.execute('SELECT status,COUNT(*) AS count FROM messages WHERE campaign_id=? AND deleted=0 GROUP BY status',(campaign_id,))}
        metadata=[dict(row) for row in c.execute('SELECT m.id,m.contact_id,m.position,m.subject,m.body,t.email FROM messages m LEFT JOIN contacts t ON t.id=m.contact_id WHERE m.campaign_id=? AND m.deleted=0 ORDER BY m.id',(campaign_id,))]
        enrolled={row['contact_id'] for row in metadata}
        for row in c.execute('SELECT DISTINCT t.* FROM contacts t JOIN messages m ON m.contact_id=t.id WHERE m.campaign_id=? AND m.deleted=0',(campaign_id,)):
            targets.setdefault(row['id'],dict(row))
        total=len(targets);page=min(page,max(1,math.ceil(total/size)))
        people=sorted(targets.values(),key=lambda row:(row['name'].casefold(),row['email'].casefold(),row['id']))[(page-1)*size:page*size]
        ids=[row['id'] for row in people];messages=[]
        if ids:
            messages=[dict(row) for row in c.execute('SELECT m.*,t.email FROM messages m JOIN contacts t ON t.id=m.contact_id WHERE m.campaign_id=? AND m.deleted=0 AND m.contact_id IN ('+','.join('?' for _ in ids)+') ORDER BY m.position,m.id',(campaign_id,*ids))]
        selected={row['id'] for row in eligible}
        for person in people:
            person['tags']=json.loads(person['tags']);person['selected']=person['id'] in selected
            person['messages']=[message for message in messages if message['contact_id']==person['id']]
        sent=c.execute("SELECT COUNT(*),COUNT(DISTINCT contact_id) FROM messages WHERE campaign_id=? AND status='sent'",(campaign_id,)).fetchone()
        replies=c.execute('SELECT COUNT(*),COUNT(DISTINCT contact_id) FROM replies WHERE campaign_id=?',(campaign_id,)).fetchone()
        sent_visible=c.execute("SELECT COUNT(DISTINCT contact_id) FROM messages WHERE campaign_id=? AND deleted=0 AND status='sent'",(campaign_id,)).fetchone()[0]
        sent_ids=[row[0] for row in c.execute("SELECT DISTINCT contact_id FROM messages WHERE campaign_id=? AND status='sent'",(campaign_id,))]
        replied_ids=[row[0] for row in c.execute('SELECT DISTINCT contact_id FROM replies WHERE campaign_id=?',(campaign_id,))]
        summary={'recipients':total,'eligible':len(eligible),'prepared_recipients':len(enrolled),'messages':len(metadata),'steps':len(steps),'counts':counts,'message_ids':[row['id'] for row in metadata],'sent':sent[0],'contacted':sent[1],'sent_contact_ids':sent_ids,'replied_contact_ids':replied_ids,'sent_visible_recipients':sent_visible,'replies':replies[0],'replied':replies[1],'signal_audience':ruled}
        fingerprint=hashlib.sha256(json.dumps([campaign['revision'],metadata],sort_keys=True).encode()).hexdigest()
    return {'campaign_id':campaign_id,'project_id':campaign['project_id'],'revision':campaign['revision'],'summary':summary,'steps':steps,'conditions':json.loads(campaign['conditions']),'recipients':people,'page':page,'page_size':size,'total':total,'fingerprint':fingerprint}
