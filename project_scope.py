"""Project campaign ownership and opt-in shared contact pools."""
import re


def active(c):
    return c.execute('SELECT project_id FROM seller_project_selection WHERE id=1').fetchone()[0]


def contact_pool(c, project_id=None):
    project_id=active(c) if project_id is None else int(project_id)
    row=c.execute('SELECT share_contacts FROM seller_projects WHERE id=? AND deleted=0',(project_id,)).fetchone()
    if not row:raise ValueError('Nie znaleziono projektu.')
    return 0 if row[0] else project_id


def require_contact(c, contact_id, project_id=None):
    if not c.execute('SELECT 1 FROM contacts WHERE id=? AND contact_pool=?',(int(contact_id),contact_pool(c,project_id))).fetchone():
        raise ValueError('Nie znaleziono kontaktu w tym projekcie.')


def require_campaign(c, campaign_id, project_id=None):
    if not c.execute("SELECT 1 FROM campaigns WHERE id=? AND project_id=? AND status!='deleted'",(int(campaign_id),active(c) if project_id is None else project_id)).fetchone():
        raise ValueError('Nie znaleziono kampanii w tym projekcie.')


def guard_request(c,path,item):
    if path.startswith('/api/campaign/') and path!='/api/campaign/preview':
        require_campaign(c,item.get('campaign_id') if path=='/api/campaign/messages/delete' else item.get('id'))
    if path=='/api/message':
        row=c.execute('SELECT campaign_id FROM messages WHERE id=?',(int(item['id']),)).fetchone()
        if not row:raise ValueError('Nie znaleziono wiadomości.')
        require_campaign(c,row[0])
    if path.startswith('/api/contact/'):
        require_contact(c,item['id'])
    if path=='/api/contacts/tags/bulk':
        for contact_id in item.get('ids',[]):require_contact(c,contact_id)
    if path in ('/api/campaigns','/api/campaign/preview'):
        for contact_id in item.get('contact_ids',[]):require_contact(c,contact_id)
        if item.get('preview_contact_id'):require_contact(c,item['preview_contact_id'])
    if path in ('/api/prospecting/verify','/api/prospecting/draft'):
        row=c.execute('SELECT project_id FROM prospect_runs WHERE id=?',(int(item['id']),)).fetchone()
        if not row or row[0]!=active(c):raise ValueError('Nie znaleziono wyszukiwania w tym projekcie.')
    if path=='/api/signals/rules' and item.get('campaign_id'):require_campaign(c,item['campaign_id'])


def migrate(c):
    if 'contact_pool' in {r[1] for r in c.execute('PRAGMA table_info(contacts)')}:return
    # SQLite cannot drop the old email-only UNIQUE constraint with ALTER TABLE.
    # Preserve IDs, all columns, indexes and referencing rows during the rebuild.
    c.commit()
    c.execute('PRAGMA foreign_keys=OFF')
    try:
        c.execute('BEGIN IMMEDIATE')
        c.execute('ALTER TABLE seller_projects ADD COLUMN share_contacts INTEGER NOT NULL DEFAULT 1 CHECK(share_contacts IN (0,1))')
        owner=c.execute('SELECT MIN(id) FROM seller_projects WHERE deleted=0').fetchone()[0]
        c.execute('ALTER TABLE campaigns ADD COLUMN project_id INTEGER NOT NULL DEFAULT '+str(int(owner))+' REFERENCES seller_projects(id)')
        c.execute('UPDATE campaigns SET project_id=COALESCE((SELECT r.project_id FROM prospect_runs r JOIN seller_projects p ON p.id=r.project_id WHERE r.campaign_id=campaigns.id AND p.deleted=0 LIMIT 1),project_id)')
        c.execute('ALTER TABLE replies ADD COLUMN project_id INTEGER REFERENCES seller_projects(id)')
        c.execute("UPDATE replies SET project_id=COALESCE((SELECT p.project_id FROM messages m JOIN campaigns p ON p.id=m.campaign_id WHERE m.contact_id=replies.contact_id AND m.status IN ('sent','uncertain') ORDER BY m.sent_at DESC LIMIT 1),?)",(owner,))
        sql=c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='contacts'").fetchone()[0]
        sql=re.sub(r'(?i)CREATE TABLE\s+contacts', 'CREATE TABLE contacts_scoped',sql,count=1)
        sql=re.sub(r'(?i)email TEXT UNIQUE', 'email TEXT',sql,count=1)
        sql=sql.rstrip()[:-1]+', contact_pool INTEGER NOT NULL DEFAULT 0, UNIQUE(email,contact_pool))'
        indexes=[row[0] for row in c.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='contacts' AND sql IS NOT NULL")]
        columns=','.join('"'+row[1]+'"' for row in c.execute('PRAGMA table_info(contacts)'))
        c.execute(sql)
        c.execute('INSERT INTO contacts_scoped('+columns+') SELECT '+columns+' FROM contacts')
        c.execute('DROP TABLE contacts')
        c.execute('ALTER TABLE contacts_scoped RENAME TO contacts')
        for sql in indexes:c.execute(sql)
        c.execute('CREATE INDEX idx_contacts_pool ON contacts(contact_pool)')
        c.execute('CREATE INDEX idx_campaigns_project ON campaigns(project_id)')
        c.execute('ALTER TABLE contact_tag_definitions RENAME TO contact_tag_definitions_legacy')
        c.execute('CREATE TABLE contact_tag_definitions(id INTEGER PRIMARY KEY,name TEXT NOT NULL,tag_key TEXT NOT NULL,contact_pool INTEGER NOT NULL DEFAULT 0,UNIQUE(tag_key,contact_pool))')
        c.execute('INSERT INTO contact_tag_definitions(id,name,tag_key) SELECT id,name,tag_key FROM contact_tag_definitions_legacy')
        c.execute('DROP TABLE contact_tag_definitions_legacy')
        if list(c.execute('PRAGMA foreign_key_check')):raise ValueError('Project migration failed foreign key validation')
        c.commit()
    except Exception:
        c.rollback();raise
    finally:c.execute('PRAGMA foreign_keys=ON')
