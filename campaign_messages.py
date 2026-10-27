"""Paged campaign messages and reversible removal from the working list."""
import math


def init_schema(c):
    if 'deleted' not in {row[1] for row in c.execute('PRAGMA table_info(messages)')}:
        c.execute('ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
    c.execute('CREATE INDEX IF NOT EXISTS campaign_message_pages ON messages(campaign_id,deleted,id)')


def page(db,campaign_id,page_number=1,page_size=25):
    campaign_id=int(campaign_id);page_number=int(page_number);page_size=int(page_size)
    if page_number<1 or page_size not in (10,25,50,100):raise ValueError('Nieprawidłowa strona wiadomości.')
    with db() as c:
        if not c.execute("SELECT 1 FROM campaigns WHERE id=? AND status!='deleted'",(campaign_id,)).fetchone():raise ValueError('Nie znaleziono kampanii.')
        total=c.execute('SELECT COUNT(*) FROM messages WHERE campaign_id=? AND deleted=0',(campaign_id,)).fetchone()[0]
        page_number=min(page_number,max(1,math.ceil(total/page_size)))
        rows=[dict(row) for row in c.execute('SELECT m.*,t.email FROM messages m LEFT JOIN contacts t ON t.id=m.contact_id WHERE m.campaign_id=? AND m.deleted=0 ORDER BY m.id DESC LIMIT ? OFFSET ?',(campaign_id,page_size,(page_number-1)*page_size))]
    return {'messages':rows,'total':total,'page':page_number,'page_size':page_size}


def remove(db,item):
    campaign_id=item.get('campaign_id');ids=item.get('ids')
    if type(campaign_id)!=int or not isinstance(ids,list) or not 1<=len(ids)<=2000 or any(type(i)!=int or i<1 for i in ids):raise ValueError('Wybierz wiadomości do usunięcia.')
    ids=list(dict.fromkeys(ids));rows=[];cancelled=0
    with db() as c:
        c.execute('PRAGMA busy_timeout=3000')
        c.execute('BEGIN IMMEDIATE')
        campaign=c.execute("SELECT status FROM campaigns WHERE id=? AND status!='deleted'",(campaign_id,)).fetchone()
        if not campaign:raise ValueError('Nie znaleziono kampanii.')
        if campaign['status']=='active':raise ValueError('Wstrzymaj kampanię przed usunięciem wiadomości.')
        for start in range(0,len(ids),500):
            chunk=ids[start:start+500]
            rows.extend(c.execute('SELECT * FROM messages WHERE campaign_id=? AND deleted=0 AND id IN ('+','.join('?'*len(chunk))+')',(campaign_id,*chunk)).fetchall())
        if len(rows)!=len(ids):raise ValueError('Nie znaleziono wszystkich wybranych wiadomości w tej kampanii.')
        if any(row['status']=='sending' for row in rows):raise ValueError('Wybrana wiadomość jest właśnie wysyłana. Poczekaj na zakończenie.')
        for row in rows:
            if row['status']=='queued':
                cancelled+=c.execute("UPDATE messages SET status='cancelled',error='Usunięto wcześniejszą wiadomość z sekwencji.' WHERE campaign_id=? AND contact_id=? AND position>? AND status='queued' AND deleted=0",(campaign_id,row['contact_id'],row['position'])).rowcount
                c.execute("UPDATE messages SET status='cancelled' WHERE id=?",(row['id'],))
        c.executemany('UPDATE messages SET deleted=1 WHERE id=?',((i,) for i in ids))
    return {'deleted':len(ids),'cancelled_followups':cancelled}
