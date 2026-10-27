"""Semicolon-delimited contact tags and campaign recipient matching."""
import json
import unicodedata


def parse(value):
    if isinstance(value,str):
        if len(value)>3000:raise ValueError('Tagi: maksymalnie 3000 znaków.')
        value=value.split(';')
    if not isinstance(value,list) or any(not isinstance(tag,str) for tag in value):raise ValueError('Podaj tagi rozdzielone średnikiem.')
    result=[];seen=set()
    for tag in value:
        if any(unicodedata.category(char)=='Cc' for char in tag) or ';' in tag:raise ValueError('Tag nie może zawierać średnika ani znaków sterujących.')
        tag=unicodedata.normalize('NFC',tag).strip()
        if len(tag)>100:raise ValueError('Tag: maksymalnie 100 znaków.')
        if tag and tag.casefold() not in seen:result.append(tag);seen.add(tag.casefold())
    if len(result)>30:raise ValueError('Kontakt może mieć maksymalnie 30 tagów.')
    return result


def init_schema(c):
    if 'tags' not in {row[1] for row in c.execute('PRAGMA table_info(contacts)')}:
        c.execute("ALTER TABLE contacts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        for row in c.execute("SELECT id,target_group FROM contacts WHERE target_group!=''").fetchall():
            c.execute('UPDATE contacts SET tags=? WHERE id=?',(json.dumps(parse(row['target_group']),ensure_ascii=False),row['id']))
    if 'audience_tags' not in {row[1] for row in c.execute('PRAGMA table_info(campaigns)')}:
        c.execute("ALTER TABLE campaigns ADD COLUMN audience_tags TEXT NOT NULL DEFAULT '[]'")
        for row in c.execute("SELECT id,target_group FROM campaigns WHERE audience_mode='group'").fetchall():
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags=? WHERE id=?",(json.dumps(parse(row['target_group']),ensure_ascii=False),row['id']))
    if 'tag_match' not in {row[1] for row in c.execute('PRAGMA table_info(campaigns)')}:
        c.execute("ALTER TABLE campaigns ADD COLUMN tag_match TEXT NOT NULL DEFAULT 'any'")
    c.execute('CREATE TABLE IF NOT EXISTS contact_tag_definitions(id INTEGER PRIMARY KEY,name TEXT NOT NULL,tag_key TEXT NOT NULL UNIQUE)')
    for row in c.execute('SELECT tags FROM contacts').fetchall():register(c,stored(row['tags']))
    for row in c.execute("SELECT audience_tags FROM campaigns WHERE audience_mode='tags'").fetchall():register(c,stored(row['audience_tags']))


def stored(value):
    return json.loads(value) if isinstance(value,str) else value


def catalog(c):
    unique={row['tag_key']:row['name'] for row in c.execute('SELECT name,tag_key FROM contact_tag_definitions ORDER BY id')}
    for row in c.execute('SELECT tags FROM contacts ORDER BY id'):
        for tag in stored(row['tags']):unique.setdefault(tag.casefold(),tag)
    return sorted(unique.values(),key=str.casefold)


def register(c,tags):
    for tag in parse(tags):c.execute('INSERT OR IGNORE INTO contact_tag_definitions(name,tag_key) VALUES(?,?)',(tag,tag.casefold()))


def names(db):
    with db() as c:return catalog(c)


def normalize(c,value):
    known={tag.casefold():tag for tag in catalog(c)}
    return [known.get(tag.casefold(),tag) for tag in parse(value)]


def set_tags(c,contact_id,tags,merge=False):
    row=c.execute('SELECT tags FROM contacts WHERE id=?',(contact_id,)).fetchone()
    if not row:raise ValueError('Nie znaleziono kontaktu.')
    tags=normalize(c,stored(row['tags'])+parse(tags) if merge else tags)
    register(c,tags)
    c.execute('UPDATE contacts SET tags=?,target_group=? WHERE id=?',(json.dumps(tags,ensure_ascii=False),'; '.join(tags),contact_id))
    return tags


def assign(db,item):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        tags=set_tags(c,int(item['id']),item.get('tags',''))
    return {'ok':True,'tags':tags}


def bulk_assign(db,item):
    ids=item.get('ids')
    if not isinstance(ids,list) or not 1<=len(ids)<=2000 or any(type(value)!=int or value<=0 for value in ids):raise ValueError('Wybierz od 1 do 2000 kontaktów.')
    ids=list(dict.fromkeys(ids))
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        tags=normalize(c,item.get('tags',[]))
        if not tags:raise ValueError('Wybierz co najmniej jeden tag.')
        rows=[]
        for start in range(0,len(ids),500):
            batch=ids[start:start+500]
            rows.extend(c.execute('SELECT id,tags FROM contacts WHERE id IN ('+','.join('?' for _ in batch)+')',batch).fetchall())
        if len(rows)!=len(ids):raise ValueError('Nie znaleziono części zaznaczonych kontaktów. Odśwież listę.')
        updates=[]
        for row in rows:
            merged=parse(stored(row['tags'])+tags)
            updates.append((json.dumps(merged,ensure_ascii=False),'; '.join(merged),row['id']))
        register(c,tags)
        c.executemany('UPDATE contacts SET tags=?,target_group=? WHERE id=?',updates)
    return {'updated':len(ids),'tags':tags}


def validate_campaign(c,item):
    if item.get('audience_mode')!='tags':return [],'any'
    tags=normalize(c,item.get('audience_tags',[]));match=item.get('tag_match','any')
    if not tags:raise ValueError('Wybierz co najmniej jeden tag odbiorców.')
    known={tag.casefold() for tag in catalog(c)}
    if any(tag.casefold() not in known for tag in tags):raise ValueError('Wybrany tag nie istnieje w kontaktach.')
    if match not in ('any','all'):raise ValueError('Nieprawidłowy sposób dopasowania tagów.')
    return tags,match


def matches(tags,selected,match='any'):
    own={tag.casefold() for tag in stored(tags)};wanted={tag.casefold() for tag in stored(selected)}
    return bool(wanted) and (wanted<=own if match=='all' else bool(own&wanted))


def state(db):
    with db() as c:
        rows=[dict(row,contacts=0,campaigns=0) for row in c.execute('SELECT id,name,tag_key FROM contact_tag_definitions ORDER BY name COLLATE NOCASE')]
        counts={row['tag_key']:row for row in rows}
        for row in c.execute('SELECT tags FROM contacts'):
            for tag in stored(row['tags']):
                if tag.casefold() in counts:counts[tag.casefold()]['contacts']+=1
        for row in c.execute("SELECT audience_tags FROM campaigns WHERE audience_mode='tags' AND status!='deleted'"):
            for tag in stored(row['audience_tags']):
                if tag.casefold() in counts:counts[tag.casefold()]['campaigns']+=1
    return rows


def manage(db,item):
    action=item.get('action')
    if action not in ('create','rename','delete'):raise ValueError('Nieznana operacja na tagach.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if action in ('create','rename'):
            values=parse(item.get('name'))
            if len(values)!=1:raise ValueError('Podaj nazwę jednego tagu.')
            name=values[0];key=name.casefold()
            existing=c.execute('SELECT id FROM contact_tag_definitions WHERE tag_key=?',(key,)).fetchone()
            if existing and (action=='create' or existing['id']!=int(item.get('id',0))):raise ValueError('Tag o tej nazwie już istnieje.')
        if action=='create':
            tag_id=c.execute('INSERT INTO contact_tag_definitions(name,tag_key) VALUES(?,?)',(name,key)).lastrowid
            return {'id':tag_id,'name':name,'action':action}
        row=c.execute('SELECT * FROM contact_tag_definitions WHERE id=?',(int(item['id']),)).fetchone()
        if not row:raise ValueError('Nie znaleziono tagu.')
        old=row['tag_key'];replacement=name if action=='rename' else None
        def replace(values):
            return parse([replacement if tag.casefold()==old else tag for tag in stored(values) if tag.casefold()!=old or replacement is not None])
        contacts=campaigns=0
        for contact in c.execute('SELECT id,tags FROM contacts').fetchall():
            if old not in {tag.casefold() for tag in stored(contact['tags'])}:continue
            tags=replace(contact['tags']);contacts+=1
            c.execute('UPDATE contacts SET tags=?,target_group=? WHERE id=?',(json.dumps(tags,ensure_ascii=False),'; '.join(tags),contact['id']))
        for campaign in c.execute("SELECT id,audience_tags FROM campaigns WHERE audience_mode='tags'").fetchall():
            if old not in {tag.casefold() for tag in stored(campaign['audience_tags'])}:continue
            tags=replace(campaign['audience_tags']);campaigns+=1
            c.execute('UPDATE campaigns SET audience_tags=? WHERE id=?',(json.dumps(tags,ensure_ascii=False),campaign['id']))
            if action=='delete':
                c.execute("UPDATE campaigns SET status='paused' WHERE id=? AND status='active'",(campaign['id'],))
                c.execute("UPDATE messages SET status='cancelled',error='Usunięto tag odbiorców kampanii. Sprawdź wybór odbiorców.' WHERE campaign_id=? AND status='queued'",(campaign['id'],))
        if action=='rename':c.execute('UPDATE contact_tag_definitions SET name=?,tag_key=? WHERE id=?',(name,key,row['id']))
        else:c.execute('DELETE FROM contact_tag_definitions WHERE id=?',(row['id'],))
    return {'action':action,'old_name':row['name'],'name':replacement,'contacts':contacts,'campaigns':campaigns}
