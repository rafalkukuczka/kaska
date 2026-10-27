"""Named seller projects with a persisted active selection."""
import json
import time
import languages
import search_areas

FIELDS={'website':2000,'offer':10000,'audience':3000,'pain_points':10000,'value_props':10000,'proof_points':10000}


def blank_project():return {**{key:'' for key in FIELDS},'search_languages':[],'search_areas':[]}


def init_schema(c):
    c.execute('CREATE TABLE IF NOT EXISTS seller_project(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if not c.execute('SELECT 1 FROM seller_project WHERE id=1').fetchone():
        project=blank_project()
        row=c.execute("SELECT website,offer,audience,pain_points,value_props,proof_points FROM prospect_runs WHERE website!='' OR offer!='' ORDER BY updated DESC,id DESC LIMIT 1").fetchone()
        if row:project.update(dict(row))
        else:
            row=c.execute('SELECT website,offer FROM content_projects ORDER BY updated DESC,id DESC LIMIT 1').fetchone()
            if row:project.update(dict(row))
        c.execute('INSERT INTO seller_project(id,data,updated) VALUES(1,?,?)',(json.dumps(project,ensure_ascii=False),time.time()))
    c.execute('CREATE TABLE IF NOT EXISTS seller_projects(id INTEGER PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL)')
    if 'deleted' not in {r[1] for r in c.execute('PRAGMA table_info(seller_projects)')}:
        c.execute('ALTER TABLE seller_projects ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
    c.execute('CREATE TABLE IF NOT EXISTS seller_project_selection(id INTEGER PRIMARY KEY CHECK(id=1),project_id INTEGER NOT NULL REFERENCES seller_projects(id))')
    if not c.execute('SELECT 1 FROM seller_projects').fetchone():
        c.execute("INSERT INTO seller_projects(id,name,data,revision,updated) SELECT id,'Projekt 1',data,revision,updated FROM seller_project WHERE id=1")
    c.execute('INSERT OR IGNORE INTO seller_project_selection(id,project_id) SELECT 1,MIN(id) FROM seller_projects')


def get(db,project_id=None):
    with db() as c:
        if project_id is None:project_id=c.execute('SELECT project_id FROM seller_project_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_projects WHERE id=? AND deleted=0',(int(project_id),)).fetchone()
    if not row:raise ValueError('Nie znaleziono projektu.')
    return {'search_languages':[],'search_areas':[],**json.loads(row['data']),'id':row['id'],'name':row['name'],'revision':row['revision'],'updated':row['updated'],'share_contacts':bool(row['share_contacts'])}


def projects(db):
    with db() as c:return [dict(row) for row in c.execute("SELECT id,name,share_contacts,json_extract(data,'$.website') AS website FROM seller_projects WHERE deleted=0 ORDER BY id")]


def project_name(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=100:raise ValueError('Podaj nazwę projektu od 1 do 100 znaków.')
    return value.strip()


def create(db,item):
    name=project_name(item.get('name'))
    share_contacts=item.get('share_contacts',False)
    if type(share_contacts) is not bool:raise ValueError('share_contacts must be a boolean')
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        project_id=c.execute('INSERT INTO seller_projects(name,data,updated,share_contacts) VALUES(?,?,?,?)',
                             (name,json.dumps(blank_project()),time.time(),int(share_contacts))).lastrowid
        c.execute('UPDATE seller_project_selection SET project_id=? WHERE id=1',(project_id,))
    return get(db,project_id)


def select(db,item):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        project_id=int(item['project_id'])
        if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project_id,)).fetchone():raise ValueError('Nie znaleziono projektu.')
        c.execute('UPDATE seller_project_selection SET project_id=? WHERE id=1',(project_id,))
    return get(db,project_id)


def delete(db,item):
    project_id=int(item['project_id'])
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        if not c.execute('SELECT 1 FROM seller_projects WHERE id=? AND deleted=0',(project_id,)).fetchone():raise ValueError('Nie znaleziono projektu.')
        if c.execute("SELECT 1 FROM prospect_runs WHERE project_id=? AND status IN ('searching','verifying','drafting')",(project_id,)).fetchone():
            raise ValueError('Poczekaj na zakończenie wyszukiwania lub tworzenia szkiców w tym projekcie.')
        c.execute('UPDATE seller_projects SET deleted=1 WHERE id=?',(project_id,))
        c.execute("UPDATE campaigns SET status='paused' WHERE project_id=? AND status='active'",(project_id,))
        c.execute('UPDATE signal_rules SET enabled=0 WHERE campaign_id IN (SELECT id FROM campaigns WHERE project_id=?)',(project_id,))
        # Pause sources owned only by this project. Shared sources keep working elsewhere.
        c.execute("""UPDATE signal_sources SET enabled=0 WHERE id IN (
          SELECT s.source_id FROM signal_monitor_sources s JOIN signal_monitors m ON m.id=s.monitor_id WHERE m.project_id=?)
          AND NOT EXISTS(SELECT 1 FROM signal_monitor_sources s JOIN signal_monitors m ON m.id=s.monitor_id
          JOIN seller_projects p ON p.id=m.project_id WHERE s.source_id=signal_sources.id AND p.deleted=0 AND m.status='active')""",(project_id,))
        c.execute("UPDATE signal_monitors SET status='deleted' WHERE project_id=?",(project_id,))
        active=c.execute('SELECT project_id FROM seller_project_selection WHERE id=1').fetchone()[0]
        if active==project_id:
            replacement=c.execute('SELECT id FROM seller_projects WHERE deleted=0 ORDER BY id LIMIT 1').fetchone()
            if replacement:active=replacement[0]
            else:
                active=c.execute('INSERT INTO seller_projects(name,data,updated) VALUES(?,?,?)',
                    ('Nowy projekt',json.dumps(blank_project()),time.time())).lastrowid
                c.execute('UPDATE seller_projects SET share_contacts=0 WHERE id=?',(active,))
            c.execute('UPDATE seller_project_selection SET project_id=? WHERE id=1',(active,))
    return get(db,active)


def save(db,item):
    patch={}
    for key,limit in FIELDS.items():
        if key not in item:continue
        if not isinstance(item[key],str) or len(item[key])>limit:raise ValueError('Nieprawidłowe pole projektu: '+key)
        patch[key]=item[key]
    name=project_name(item['name']) if 'name' in item else None
    if 'search_languages' in item:patch['search_languages']=languages.validate_search_languages(item['search_languages'])
    if 'search_areas' in item:patch['search_areas']=search_areas.validate(item['search_areas'])
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000');c.execute('BEGIN IMMEDIATE')
        project_id=item.get('project_id')
        if project_id is None:project_id=c.execute('SELECT project_id FROM seller_project_selection WHERE id=1').fetchone()[0]
        row=c.execute('SELECT * FROM seller_projects WHERE id=? AND deleted=0',(int(project_id),)).fetchone()
        if not row:raise ValueError('Nie znaleziono projektu.')
        if 'revision' in item and item['revision']!=row['revision']:raise ValueError('Projekt zmieniono w innym oknie. Odśwież projekt przed zapisem.')
        project=json.loads(row['data']);project.update(patch);updated=time.time()
        name=name or row['name']
        c.execute('UPDATE seller_projects SET name=?,data=?,revision=revision+1,updated=? WHERE id=?',(name,json.dumps(project,ensure_ascii=False),updated,row['id']))
    return {'search_languages':[],'search_areas':[],**project,'id':row['id'],'name':name,'revision':row['revision']+1,'updated':updated,'share_contacts':bool(row['share_contacts'])}


def resolve(db,item):
    project=get(db,item.get('project_id'))
    return {**{key:project[key] for key in FIELDS},'search_languages':project['search_languages'],'search_areas':project['search_areas'],**item,'project_id':project['id']}
