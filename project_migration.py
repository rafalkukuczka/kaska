"""One-time, transactional migration of legacy profile schema to projects."""
import json
import re


def identifier(value):return '"'+value.replace('"','""')+'"'


def project_key(key):
    return key.replace('profile','project').replace('Profile','Project').replace('PROFILE','PROJECT')


def migrate_json(value):
    if isinstance(value,list):return [migrate_json(item) for item in value]
    if isinstance(value,dict):
        result={}
        for key,item in value.items():
            renamed=project_key(key)
            if renamed in result:raise ValueError('Konflikt danych podczas migracji projektów.')
            result[renamed]=migrate_json(item)
        return result
    return value


def migrate(c):
    tables=[row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    legacy=any('profile' in table or any('profile' in row[1] for row in c.execute('PRAGMA table_info('+identifier(table)+')')) for table in tables)
    if not legacy:return
    c.execute('BEGIN IMMEDIATE')
    try:
        previous_violations=list(c.execute('PRAGMA foreign_key_check'))
        for table in tables:
            renamed=project_key(table)
            if renamed!=table:
                if renamed in tables:raise ValueError('Istnieją już obie wersje tabeli projektu: '+renamed)
                c.execute('ALTER TABLE '+identifier(table)+' RENAME TO '+identifier(renamed))
        tables=[project_key(table) for table in tables]
        for table in tables:
            for row in list(c.execute('PRAGMA table_info('+identifier(table)+')')):
                old=row[1];new=project_key(old)
                if old!=new:c.execute('ALTER TABLE '+identifier(table)+' RENAME COLUMN '+identifier(old)+' TO '+identifier(new))
        # Update stored API context keys without changing user-written text values.
        for table in tables:
            columns=[row[1] for row in c.execute('PRAGMA table_info('+identifier(table)+')') if row[2].upper() in ('TEXT','JSON')]
            for column in columns:
                rows=c.execute('SELECT rowid,'+identifier(column)+' FROM '+identifier(table)+' WHERE '+identifier(column)+" LIKE '%profile%' OR "+identifier(column)+" LIKE '%Profile%'").fetchall()
                for rowid,text in rows:
                    try:value=json.loads(text)
                    except (ValueError,TypeError):continue
                    updated=migrate_json(value)
                    if updated!=value:c.execute('UPDATE '+identifier(table)+' SET '+identifier(column)+'=? WHERE rowid=?',(json.dumps(updated,ensure_ascii=False),rowid))
        if 'seller_projects' in tables:
            for row in c.execute('SELECT id,name FROM seller_projects').fetchall():
                if re.fullmatch(r'(?:Profil|Profile) \d+',row[1]):
                    c.execute('UPDATE seller_projects SET name=? WHERE id=?',('Projekt '+row[1].split()[-1],row[0]))
                elif row[1]=='Nowy profil':c.execute("UPDATE seller_projects SET name='Nowy projekt' WHERE id=?",(row[0],))
        for name,sql in c.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").fetchall():
            new=project_key(name)
            if new!=name:
                tail=re.split(r'\sON\s',sql,maxsplit=1,flags=re.IGNORECASE)[1]
                unique='UNIQUE ' if re.match(r'CREATE\s+UNIQUE',sql,re.IGNORECASE) else ''
                c.execute('DROP INDEX '+identifier(name))
                c.execute('CREATE '+unique+'INDEX '+identifier(new)+' ON '+tail)
        if len(list(c.execute('PRAGMA foreign_key_check')))>len(previous_violations):raise ValueError('Naruszono powiązania podczas migracji projektów.')
        c.commit()
    except Exception:
        c.rollback()
        raise
