"""Disable removed monitoring features while retaining historical records."""
import json


def retire_monitoring(c):
    c.execute('CREATE TABLE IF NOT EXISTS feature_retirements(name TEXT PRIMARY KEY)')
    if c.execute("SELECT 1 FROM feature_retirements WHERE name='monitoring-v1'").fetchone():return
    tables={row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # Existing campaign recipients must never turn into an unrestricted audience.
    rule_campaigns={row[0] for row in c.execute('SELECT campaign_id FROM signal_rules')} if 'signal_rules' in tables else set()
    for row in c.execute('SELECT id,audience_mode,contact_ids FROM campaigns').fetchall():
        if row['audience_mode']!='signals' and row['id'] not in rule_campaigns:continue
        selected=json.loads(row['contact_ids'] or '[]')
        selected.extend(r[0] for r in c.execute('SELECT DISTINCT contact_id FROM messages WHERE campaign_id=?',(row['id'],)))
        c.execute("UPDATE campaigns SET audience_mode='selected',contact_ids=? WHERE id=?",(json.dumps(sorted(set(selected))),row['id']))
    if 'signal_rules' in tables:c.execute('UPDATE signal_rules SET enabled=0')
    if 'signal_sources' in tables:c.execute('UPDATE signal_sources SET enabled=0')
    if 'signal_analysis_settings' in tables:c.execute('UPDATE signal_analysis_settings SET enabled=0')
    if 'signal_analyses' in tables:c.execute("UPDATE signal_analyses SET status='interrupted',stage='Funkcja wycofana.' WHERE status IN ('running','queued')")
    if 'source_discovery_jobs' in tables:c.execute("UPDATE source_discovery_jobs SET status='interrupted',stage='Funkcja wycofana.' WHERE status IN ('running','cancelling')")
    c.execute("INSERT INTO feature_retirements(name) VALUES('monitoring-v1')")
