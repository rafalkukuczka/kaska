"""One persisted seller profile used by prospecting and market discovery."""
import json
import time

FIELDS={'website':2000,'offer':10000,'audience':3000,'pain_points':10000,'value_props':10000,'proof_points':10000}


def init_schema(c):
    c.execute('CREATE TABLE IF NOT EXISTS seller_profile(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if c.execute('SELECT 1 FROM seller_profile WHERE id=1').fetchone():return
    profile={key:'' for key in FIELDS}
    row=c.execute("SELECT website,offer,audience,pain_points,value_props,proof_points FROM prospect_runs WHERE website!='' OR offer!='' ORDER BY updated DESC,id DESC LIMIT 1").fetchone()
    if row:profile.update(dict(row))
    else:
        row=c.execute('SELECT website,offer FROM content_profiles ORDER BY updated DESC,id DESC LIMIT 1').fetchone()
        if row:profile.update(dict(row))
    c.execute('INSERT INTO seller_profile(id,data,updated) VALUES(1,?,?)',(json.dumps(profile,ensure_ascii=False),time.time()))


def get(db):
    with db() as c:row=c.execute('SELECT * FROM seller_profile WHERE id=1').fetchone()
    return {**json.loads(row['data']),'revision':row['revision'],'updated':row['updated']}


def save(db,item):
    patch={}
    for key,limit in FIELDS.items():
        if key not in item:continue
        if not isinstance(item[key],str) or len(item[key])>limit:raise ValueError('Nieprawidłowe pole profilu: '+key)
        patch[key]=item[key]
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT * FROM seller_profile WHERE id=1').fetchone()
        if 'revision' in item and item['revision']!=row['revision']:raise ValueError('Profil zmieniono w innym oknie. Odśwież profil przed zapisem.')
        profile=json.loads(row['data']);profile.update(patch);updated=time.time()
        c.execute('UPDATE seller_profile SET data=?,revision=revision+1,updated=? WHERE id=1',(json.dumps(profile,ensure_ascii=False),updated))
    return {**profile,'revision':row['revision']+1,'updated':updated}


def resolve(db,item):
    profile=get(db)
    return {**{key:profile[key] for key in FIELDS},**item}
