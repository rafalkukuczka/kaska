"""Named seller profiles with a persisted active selection."""
import json
import time
import languages
import search_areas

FIELDS={'website':2000,'offer':10000,'audience':3000,'pain_points':10000,'value_props':10000,'proof_points':10000}


def blank_profile():return {**{key:'' for key in FIELDS},'search_languages':[],'search_areas':[]}


def init_schema(c):
    c.execute('CREATE TABLE IF NOT EXISTS seller_profile(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if not c.execute('SELECT 1 FROM seller_profile WHERE id=1').fetchone():
        profile=blank_profile()
        row=c.execute("SELECT website,offer,audience,pain_points,value_props,proof_points FROM prospect_runs WHERE website!='' OR offer!='' ORDER BY updated DESC,id DESC LIMIT 1").fetchone()
        if row:profile.update(dict(row))
        else:
            row=c.execute('SELECT website,offer FROM content_profiles ORDER BY updated DESC,id DESC LIMIT 1').fetchone()
            if row:profile.update(dict(row))
        c.execute('INSERT INTO seller_profile(id,data,updated) VALUES(1,?,?)',(json.dumps(profile,ensure_ascii=False),time.time()))
    c.execute('CREATE TABLE IF NOT EXISTS seller_profiles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if 'deleted' not in {r[1] for r in c.execute('PRAGMA table_info(seller_profiles)')}:
        c.execute('ALTER TABLE seller_profiles ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
    c.execute('CREATE TABLE IF NOT EXISTS seller_profile_selection(id INTEGER PRIMARY KEY CHECK(id=1),profile_id INTEGER NOT NULL REFERENCES seller_profiles(id))')
    if not c.execute('SELECT 1 FROM seller_profiles').fetchone():
        c.execute("INSERT INTO seller_profiles(id,name,data,revision,updated) SELECT id,'Profil 1',data,revision,updated FROM seller_profile WHERE id=1")
    c.execute('INSERT OR IGNORE INTO seller_profile_selection(id,profile_id) SELECT 1,MIN(id) FROM seller_profiles')


def get(db,profile_id=None):
    with db() as c:
        if profile_id is None:profile_id=c.execute('SELECT profile_id FROM seller_profile_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_profiles WHERE id=? AND deleted=0',(int(profile_id),)).fetchone()
    if not row:raise ValueError('Nie znaleziono profilu.')
    return {'search_languages':[],'search_areas':[],**json.loads(row['data']),'id':row['id'],'name':row['name'],'revision':row['revision'],'updated':row['updated']}


def profiles(db):
    with db() as c:return [dict(row) for row in c.execute("SELECT id,name,json_extract(data,'$.website') AS website FROM seller_profiles WHERE deleted=0 ORDER BY id")]


def profile_name(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=100:raise ValueError('Podaj nazwę profilu od 1 do 100 znaków.')
    return value.strip()


def create(db,item):
    name=profile_name(item.get('name'))
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        profile_id=c.execute('INSERT INTO seller_profiles(name,data,updated) VALUES(?,?,?)',
                             (name,json.dumps(blank_profile()),time.time())).lastrowid
        c.execute('UPDATE seller_profile_selection SET profile_id=? WHERE id=1',(profile_id,))
    return get(db,profile_id)


def select(db,item):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        profile_id=int(item['profile_id'])
        if not c.execute('SELECT 1 FROM seller_profiles WHERE id=? AND deleted=0',(profile_id,)).fetchone():raise ValueError('Nie znaleziono profilu.')
        c.execute('UPDATE seller_profile_selection SET profile_id=? WHERE id=1',(profile_id,))
    return get(db,profile_id)


def delete(db,item):
    profile_id=int(item['profile_id'])
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        if not c.execute('SELECT 1 FROM seller_profiles WHERE id=? AND deleted=0',(profile_id,)).fetchone():raise ValueError('Nie znaleziono profilu.')
        if c.execute("SELECT 1 FROM prospect_runs WHERE profile_id=? AND status IN ('searching','verifying','drafting')",(profile_id,)).fetchone():
            raise ValueError('Poczekaj na zakończenie wyszukiwania lub tworzenia szkiców w tym profilu.')
        c.execute('UPDATE seller_profiles SET deleted=1 WHERE id=?',(profile_id,))
        # Pause sources owned only by this profile. Shared sources keep working elsewhere.
        c.execute("""UPDATE signal_sources SET enabled=0 WHERE id IN (
          SELECT s.source_id FROM signal_monitor_sources s JOIN signal_monitors m ON m.id=s.monitor_id WHERE m.profile_id=?)
          AND NOT EXISTS(SELECT 1 FROM signal_monitor_sources s JOIN signal_monitors m ON m.id=s.monitor_id
          JOIN seller_profiles p ON p.id=m.profile_id WHERE s.source_id=signal_sources.id AND p.deleted=0 AND m.status='active')""",(profile_id,))
        c.execute("UPDATE signal_monitors SET status='deleted' WHERE profile_id=?",(profile_id,))
        active=c.execute('SELECT profile_id FROM seller_profile_selection WHERE id=1').fetchone()[0]
        if active==profile_id:
            replacement=c.execute('SELECT id FROM seller_profiles WHERE deleted=0 ORDER BY id LIMIT 1').fetchone()
            if replacement:active=replacement[0]
            else:
                active=c.execute('INSERT INTO seller_profiles(name,data,updated) VALUES(?,?,?)',
                    ('Nowy profil',json.dumps(blank_profile()),time.time())).lastrowid
            c.execute('UPDATE seller_profile_selection SET profile_id=? WHERE id=1',(active,))
    return get(db,active)


def save(db,item):
    patch={}
    for key,limit in FIELDS.items():
        if key not in item:continue
        if not isinstance(item[key],str) or len(item[key])>limit:raise ValueError('Nieprawidłowe pole profilu: '+key)
        patch[key]=item[key]
    name=profile_name(item['name']) if 'name' in item else None
    if 'search_languages' in item:patch['search_languages']=languages.validate_search_languages(item['search_languages'])
    if 'search_areas' in item:patch['search_areas']=search_areas.validate(item['search_areas'])
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        profile_id=item.get('profile_id')
        if profile_id is None:profile_id=c.execute('SELECT profile_id FROM seller_profile_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_profiles WHERE id=? AND deleted=0',(int(profile_id),)).fetchone()
        if not row:raise ValueError('Nie znaleziono profilu.')
        if 'revision' in item and item['revision']!=row['revision']:raise ValueError('Profil zmieniono w innym oknie. Odśwież profil przed zapisem.')
        profile=json.loads(row['data']);profile.update(patch);updated=time.time()
        name=name or row['name']
        c.execute('UPDATE seller_profiles SET name=?,data=?,revision=revision+1,updated=? WHERE id=?',(name,json.dumps(profile,ensure_ascii=False),updated,row['id']))
    return {'search_languages':[],'search_areas':[],**profile,'id':row['id'],'name':name,'revision':row['revision']+1,'updated':updated}


def resolve(db,item):
    profile=get(db,item.get('profile_id'))
    return {**{key:profile[key] for key in FIELDS},'search_languages':profile['search_languages'],'search_areas':profile['search_areas'],**item,'profile_id':profile['id']}
