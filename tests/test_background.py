import json
import threading
import time
import urllib.request
import unittest

import test_app
import app
import shared_project


class BackgroundTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_administration_shows_active_jobs_and_filtered_history(self):
        now=time.time()
        with app.db() as c:
            c.execute("INSERT INTO lead_search_jobs(project_id,kind,search_id,status,lease) VALUES(1,'research',0,'running',?)",(now+60,))
            c.execute("INSERT INTO opportunity_searches(project_id,signature,request,status,stage,total,created,updated) VALUES(1,'fixture','{}','error','Nie udało się wyszukać okazji',1,?,?)",(now,now))
        app.event('Przygotowano wiadomości')
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        old=app.PORT
        app.PORT=server.server_address[1]
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(setattr,app,'PORT',old)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        def read(level):
            request=urllib.request.Request(f'http://127.0.0.1:{app.PORT}/api/admin/logs',
                data=json.dumps({'level':level}).encode(),
                headers={'Content-Type':'application/json','X-CSRF-Token':app.workspace_csrf()})
            with urllib.request.urlopen(request) as response:
                return json.load(response)

        with app.diagnostics.working('Odczyt odpowiedzi'):
            active=read('info')
        self.assertEqual([row['label'] for row in active['jobs']],['Analiza stron firm','Odczyt odpowiedzi'])
        self.assertIn('Przygotowano wiadomości',[row['detail'] for row in active['entries']])
        errors=read('error')
        self.assertEqual(len(errors['jobs']),1)
        self.assertIn('Nie udało się wyszukać okazji',[row['detail'] for row in errors['entries']])
        self.assertTrue(all(row['level']=='error' for row in errors['entries']))

    def test_progress_includes_jobs_from_other_projects_without_contact_data(self):
        other=shared_project.create(app.db,{'name':'Other project'})
        with app.db() as c:
            c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,project_id,status,stage,draft_completed,draft_total) VALUES('https://example.com','PRIVATE OFFER','Audience','','',1,1,'[]',1,2,?,'drafting','Generating messages',2,6)",(other['id'],))
        shared_project.select(app.db,{'project_id':1})
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);old=app.PORT;app.PORT=server.server_address[1]
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{app.PORT}/api/background') as response:payload=response.read().decode()
            jobs=json.loads(payload)['jobs'];self.assertEqual(len(jobs),1)
            draft=next(j for j in jobs if j['kind']=='prospecting')
            self.assertEqual((draft['completed'],draft['total'],draft['project_name']),(2,6,'Other project'))
            self.assertNotIn('PRIVATE OFFER',payload);self.assertNotIn('anna@example.com',payload)
            request=urllib.request.Request(f'http://127.0.0.1:{app.PORT}/api/background/cancel',
                data=json.dumps({'id':draft['id']}).encode(),
                headers={'Content-Type':'application/json','X-CSRF-Token':app.workspace_csrf()})
            with urllib.request.urlopen(request) as response:
                self.assertTrue(json.load(response)['ok'])
            with urllib.request.urlopen(f'http://127.0.0.1:{app.PORT}/api/background') as response:
                cancelling, = json.load(response)['jobs']
                self.assertEqual((cancelling['status'],cancelling['completed']),('cancelling',2))
            with app.db() as c:
                c.execute("UPDATE prospect_runs SET status='ready'")
            with urllib.request.urlopen(f'http://127.0.0.1:{app.PORT}/api/background') as response:self.assertEqual(json.load(response)['jobs'],[])
        finally:server.shutdown();server.server_close();app.PORT=old
