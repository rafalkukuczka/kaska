"""Read-only reports from complete, real project delivery history."""
import time
import dashboard_activity
import project_scope


def read(c,days=7,now=None):
    days=int(days)
    if days not in (7,30,90):raise ValueError('Wybierz zakres 7, 30 lub 90 dni.')
    project_id=project_scope.active(c)
    now=time.time() if now is None else now
    start=now-days*86400
    rows=[dict(row) for row in c.execute("""SELECT p.id,p.name,p.status,
        SUM(CASE WHEN m.status='sent' AND m.sent_at BETWEEN ? AND ? AND t.simulated=0 THEN 1 ELSE 0 END) AS sent,
        COUNT(DISTINCT CASE WHEN m.status='sent' AND m.sent_at BETWEEN ? AND ? AND t.simulated=0 THEN m.contact_id END) AS contacted,
        SUM(CASE WHEN m.status='queued' AND m.deleted=0 AND t.simulated=0 THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN m.status='uncertain' AND m.deleted=0 AND t.simulated=0 THEN 1 ELSE 0 END) AS uncertain
        FROM campaigns p LEFT JOIN messages m ON m.campaign_id=p.id LEFT JOIN contacts t ON t.id=m.contact_id
        WHERE p.project_id=? GROUP BY p.id ORDER BY p.id DESC""",(start,now,start,now,project_id))]
    return {'project_id':project_id,'days':days,'start':start,'end':now,'real_data':True,
            'flow':dashboard_activity.flow(c,project_id,now,days),
            'activity':dashboard_activity.read(c,project_id,now,start),'campaigns':rows}
