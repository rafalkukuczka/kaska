import json
import threading
import urllib.request
import unittest

import test_app
import app
import shared_profile


class BackgroundTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_progress_includes_jobs_from_other_profiles_without_contact_data(self):
        other=shared_profile.create(app.db,{'name':'Other profile'})
        with app.db() as c:
            c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,profile_id,status,stage,draft_completed,draft_total) VALUES('https://example.com','PRIVATE OFFER','Audience','','',1,1,'[]',1,2,?,'drafting','Generating messages',2,6)",(other['id'],))
            c.execute("INSERT INTO source_discovery_jobs(status,stage,total,completed,request,created,updated) VALUES('running','Reading sources',4,1,'{}',1,1)")
        shared_profile.select(app.db,{'profile_id':1})
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);old=app.PORT;app.PORT=server.server_address[1]
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{app.PORT}/api/background') as response:payload=response.read().decode()
            jobs=json.loads(payload)['jobs'];self.assertEqual(len(jobs),2)
            draft=next(j for j in jobs if j['kind']=='prospecting')
            self.assertEqual((draft['completed'],draft['total'],draft['profile_name']),(2,6,'Other profile'))
            self.assertNotIn('PRIVATE OFFER',payload);self.assertNotIn('anna@example.com',payload)
            with app.db() as c:
                c.execute("UPDATE prospect_runs SET status='ready'")
                c.execute("UPDATE source_discovery_jobs SET status='completed'")
            with urllib.request.urlopen(f'http://127.0.0.1:{app.PORT}/api/background') as response:self.assertEqual(json.load(response)['jobs'],[])
        finally:server.shutdown();server.server_close();app.PORT=old
