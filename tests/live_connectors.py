"""Opt-in network smoke test, isolated from the user's database. Does not send mail."""
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app

def run():
    results=[]
    with tempfile.TemporaryDirectory() as folder:
        app.DB=Path(folder)/'live.sqlite3';app.init()
        for kind,company,config in [
            ('google_news','Microsoft',{'days':7}),
            ('greenhouse','Stripe',{'board':'stripe'}),
            ('lever','Palantir',{'board':'palantir'}),
            ('gdelt','Microsoft',{'days':7}),
        ]:
            sid=app.signal_engine.source({'kind':kind,'company':company,'config':config})
            result=app.signal_engine.scan(sid)
            with app.db() as c:
                source=dict(c.execute('SELECT * FROM signal_sources WHERE id=?',(sid,)).fetchone())
                samples=[dict(r) for r in c.execute('SELECT title,url,source_date,source_date_kind FROM sales_signals WHERE source_id=? LIMIT 2',(sid,))]
            results.append({'provider':kind,'fetched':source['last_total'],'matched':source['last_matched'],'created':result['created'],'errors':result['errors'],'warning':source['last_warning'],'samples':samples})
    target=Path('test-results/live-connectors.json');target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=True,indent=2))

if __name__=='__main__':run()
