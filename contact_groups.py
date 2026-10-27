"""Optional named target groups shared by contacts, independently of seller projects."""
import unicodedata
import project_scope


def init_schema(c):
    if 'simulated' not in {row[1] for row in c.execute('PRAGMA table_info(contacts)')}:
        c.execute('ALTER TABLE contacts ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0 CHECK(simulated IN (0,1))')
    if 'target_group' not in {row[1] for row in c.execute('PRAGMA table_info(campaigns)')}:
        c.execute("ALTER TABLE campaigns ADD COLUMN target_group TEXT NOT NULL DEFAULT ''")
    if 'target_group' not in {row[1] for row in c.execute('PRAGMA table_info(contacts)')}:
        c.execute("ALTER TABLE contacts ADD COLUMN target_group TEXT NOT NULL DEFAULT ''")


def normalize(c,value):
    if not isinstance(value,str) or len(value)>100 or any(unicodedata.category(char)=='Cc' for char in value):
        raise ValueError('Grupa docelowa: maksymalnie 100 znaków, bez znaków sterujących.')
    value=unicodedata.normalize('NFC',value).strip()
    if not value:return ''
    for row in c.execute("SELECT DISTINCT target_group FROM contacts WHERE contact_pool=? AND target_group!='' ORDER BY id",(project_scope.contact_pool(c),)):
        if row[0].casefold()==value.casefold():return row[0]
    return value


def names(db):
    with db() as c:rows=c.execute("SELECT target_group FROM contacts WHERE contact_pool=? AND target_group!='' ORDER BY id",(project_scope.contact_pool(c),)).fetchall()
    unique={}
    for row in rows:unique.setdefault(row[0].casefold(),row[0])
    return sorted(unique.values(),key=str.casefold)


def campaign_group(c,item):
    if item.get('audience_mode')!='group':return ''
    group=normalize(c,item.get('target_group',''))
    if not group or not c.execute('SELECT 1 FROM contacts WHERE target_group=? AND contact_pool=?',(group,project_scope.contact_pool(c))).fetchone():
        raise ValueError('Wybierz istniejącą grupę docelową kontaktów.')
    return group


def assign(db,item):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        project_scope.require_contact(c,item['id'])
        value=normalize(c,item.get('target_group',''))
        changed=c.execute('UPDATE contacts SET target_group=? WHERE id=?',(value,int(item['id']))).rowcount
        if not changed:raise ValueError('Nie znaleziono kontaktu.')
        import contact_tags
        contact_tags.set_tags(c,int(item['id']),value)
    return {'ok':True,'target_group':value}
