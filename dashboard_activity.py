"""Complete project activity counts, independent of paginated message lists."""
import time
import project_scope


def flow(c,project_id,now=None,days=7):
    now=time.time() if now is None else now
    cutoff=now-days*86400
    potential=c.execute("""SELECT COUNT(*) FROM contacts t
        WHERE t.contact_pool=? AND t.status='active' AND t.simulated=0
        AND NOT EXISTS(SELECT 1 FROM messages m JOIN campaigns p ON p.id=m.campaign_id
            WHERE m.contact_id=t.id AND p.project_id=? AND m.status='sent' AND m.sent_at<=?)""",
        (project_scope.contact_pool(c,project_id),project_id,now)).fetchone()[0]
    contacted=c.execute("""WITH contacted AS (
        SELECT m.contact_id,MIN(m.sent_at) AS first_sent FROM messages m
        JOIN campaigns p ON p.id=m.campaign_id JOIN contacts t ON t.id=m.contact_id
        WHERE p.project_id=? AND m.status='sent' AND t.simulated=0 AND m.sent_at BETWEEN ? AND ?
        GROUP BY m.contact_id)
        SELECT COUNT(*),COALESCE(SUM(EXISTS(SELECT 1 FROM replies r WHERE r.contact_id=x.contact_id
            AND COALESCE(r.project_id,(SELECT MIN(id) FROM seller_projects WHERE deleted=0))=?
            AND r.received BETWEEN x.first_sent AND ?)),0) FROM contacted x""",
        (project_id,cutoff,now,project_id,now)).fetchone()
    total,replied=contacted
    return {'potential':potential,'contacted':total,'replied':replied,
            'reply_rate':round(replied/total*100,1) if total else None,
            'engagement_rate':None,'bounce_rate':None,'days':days,'real_data':True}


def read(c,project_id,now=None,start=None):
    now=time.time() if now is None else now
    cutoff=now-91*86400 if start is None else start
    sent=c.execute("""SELECT CAST(m.sent_at/3600 AS INTEGER)*3600 AS hour,COUNT(*)
        FROM messages m JOIN campaigns p ON p.id=m.campaign_id JOIN contacts t ON t.id=m.contact_id
        WHERE p.project_id=? AND m.status='sent' AND t.simulated=0 AND m.sent_at BETWEEN ? AND ?
        GROUP BY hour ORDER BY hour""",(project_id,cutoff,now)).fetchall()
    replies=c.execute("""SELECT CAST(r.received/3600 AS INTEGER)*3600 AS hour,COUNT(*)
        FROM replies r JOIN contacts t ON t.id=r.contact_id WHERE COALESCE(r.project_id,(SELECT MIN(id) FROM seller_projects WHERE deleted=0))=?
        AND t.simulated=0 AND r.received BETWEEN ? AND ? GROUP BY hour ORDER BY hour""",(project_id,cutoff,now)).fetchall()
    return {'sent':[list(row) for row in sent],'replies':[list(row) for row in replies]}
