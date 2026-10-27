"""Named seller profiles with a persisted active selection."""
import json
import time

FIELDS={'website':2000,'offer':10000,'audience':3000,'pain_points':10000,'value_props':10000,'proof_points':10000}


def init_schema(c):
    c.execute('CREATE TABLE IF NOT EXISTS seller_profile(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if not c.execute('SELECT 1 FROM seller_profile WHERE id=1').fetchone():
        profile={key:'' for key in FIELDS}
        row=c.execute("SELECT website,offer,audience,pain_points,value_props,proof_points FROM prospect_runs WHERE website!='' OR offer!='' ORDER BY updated DESC,id DESC LIMIT 1").fetchone()
        if row:profile.update(dict(row))
        else:
            row=c.execute('SELECT website,offer FROM content_profiles ORDER BY updated DESC,id DESC LIMIT 1').fetchone()
            if row:profile.update(dict(row))
        c.execute('INSERT INTO seller_profile(id,data,updated) VALUES(1,?,?)',(json.dumps(profile,ensure_ascii=False),time.time()))
    c.execute('CREATE TABLE IF NOT EXISTS seller_profiles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS seller_profile_selection(id INTEGER PRIMARY KEY CHECK(id=1),profile_id INTEGER NOT NULL REFERENCES seller_profiles(id))')
    if not c.execute('SELECT 1 FROM seller_profiles').fetchone():
        c.execute("INSERT INTO seller_profiles(id,name,data,revision,updated) SELECT id,'Profil 1',data,revision,updated FROM seller_profile WHERE id=1")
    c.execute('INSERT OR IGNORE INTO seller_profile_selection(id,profile_id) SELECT 1,MIN(id) FROM seller_profiles')


def get(db,profile_id=None):
    with db() as c:
        if profile_id is None:profile_id=c.execute('SELECT profile_id FROM seller_profile_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_profiles WHERE id=?',(int(profile_id),)).fetchone()
    if not row:raise ValueError('Nie znaleziono profilu.')
    return {**json.loads(row['data']),'id':row['id'],'name':row['name'],'revision':row['revision'],'updated':row['updated']}


def profiles(db):
    with db() as c:return [dict(row) for row in c.execute("SELECT id,name,json_extract(data,'$.website') AS website FROM seller_profiles ORDER BY id")]


def profile_name(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=100:raise ValueError('Podaj nazwę profilu od 1 do 100 znaków.')
    return value.strip()


def create(db,item):
    name=profile_name(item.get('name'))
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        profile_id=c.execute('INSERT INTO seller_profiles(name,data,updated) VALUES(?,?,?)',
                             (name,json.dumps({key:'' for key in FIELDS}),time.time())).lastrowid
        c.execute('UPDATE seller_profile_selection SET profile_id=? WHERE id=1',(profile_id,))
    return get(db,profile_id)


def select(db,item):
    profile=get(db,item['profile_id'])
    with db() as c:c.execute('UPDATE seller_profile_selection SET profile_id=? WHERE id=1',(profile['id'],))
    return profile


def save(db,item):
    patch={}
    for key,limit in FIELDS.items():
        if key not in item:continue
        if not isinstance(item[key],str) or len(item[key])>limit:raise ValueError('Nieprawidłowe pole profilu: '+key)
        patch[key]=item[key]
    name=profile_name(item['name']) if 'name' in item else None
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        profile_id=item.get('profile_id')
        if profile_id is None:profile_id=c.execute('SELECT profile_id FROM seller_profile_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_profiles WHERE id=?',(int(profile_id),)).fetchone()
        if not row:raise ValueError('Nie znaleziono profilu.')
        if 'revision' in item and item['revision']!=row['revision']:raise ValueError('Profil zmieniono w innym oknie. Odśwież profil przed zapisem.')
        profile=json.loads(row['data']);profile.update(patch);updated=time.time()
        name=name or row['name']
        c.execute('UPDATE seller_profiles SET name=?,data=?,revision=revision+1,updated=? WHERE id=?',(name,json.dumps(profile,ensure_ascii=False),updated,row['id']))
    return {**profile,'id':row['id'],'name':name,'revision':row['revision']+1,'updated':updated}


def resolve(db,item):
    profile=get(db,item.get('profile_id'))
    return {**{key:profile[key] for key in FIELDS},**item,'profile_id':profile['id']}
