"""Complete project activity counts, independent of paginated message lists."""
import time
import project_scope
from datetime import datetime, timedelta, timezone


def actions(c,project_id):
    cutoff=(datetime.now(timezone.utc).date()-timedelta(days=30)).isoformat()
    count=lambda sql,params: c.execute(sql,params).fetchone()[0]
    return {
        'opportunities':count("SELECT COUNT(*) FROM discovered_opportunities o LEFT JOIN opportunity_reviews r ON r.opportunity_id=o.id WHERE o.project_id=? AND COALESCE(NULLIF(o.published_date,''),o.event_date)>=? AND COALESCE(r.decision,'new')='new'",(project_id,cutoff)),
        'leads':count("SELECT COUNT(DISTINCT p.email) FROM prospect_candidates p JOIN prospect_runs r ON r.id=p.run_id WHERE r.project_id=? AND p.qualification!='rejected' AND NOT EXISTS(SELECT 1 FROM contacts t WHERE t.email=p.email AND t.contact_pool=?)",(project_id,project_scope.contact_pool(c,project_id))),
        'campaigns':count("SELECT COUNT(*) FROM campaigns p WHERE p.project_id=? AND p.status IN ('draft','paused') AND EXISTS(SELECT 1 FROM messages m WHERE m.campaign_id=p.id AND m.status='queued' AND m.deleted=0)",(project_id,)),
        'replies':count('SELECT COUNT(*) FROM replies WHERE project_id=?',(project_id,))}


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
