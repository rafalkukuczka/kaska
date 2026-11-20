import json
import threading
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import app
import lead_search
import lead_signals
import shared_project
import test_app


class LeadSearchTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_immediate_project_results_and_shared_async_research(self):
        finder = app.lead_finder
        criteria = [{'label': 'Modernizacja PLC', 'alternatives': ['modernizacja PLC']}]
        proof = {'criterion': 0, 'label': 'Modernizacja PLC', 'result': 'confirmed', 'url': 'https://example.com/',
                 'quote': 'Modernizujemy sterowniki PLC', 'observed': 1}
        new = {'origin': 'agent', 'name': 'Neue Firma', 'domain': 'neue.example', 'url': 'https://neue.example/', 'snippet': ''}
        with (
            patch('ai_service.ready', return_value=True),
            patch('languages.data_simulation', return_value=False),
            patch.object(finder, 'discover', return_value=(criteria, [new])),
            patch.object(finder, 'research', return_value=[{'text': proof['quote']}]) as research,
            patch.object(finder, 'evaluate', return_value=('qualified', [proof], 'Klara Berger · CTO')),
        ):
            first = finder.create({'query': 'Acme'})
            second = finder.create({'query': 'Acme i PLC'})
            first_id, second_id = first['search']['id'], second['search']['id']
            self.assertEqual([row['name'] for row in first['companies']], ['Acme'])
            self.assertEqual(first['notifications'], [])
            while finder.run_one():
                pass
        self.assertEqual(research.call_count, 2)
        state = finder.state(first_id)
        self.assertEqual([row['name'] for row in state['companies']], ['Acme', 'Neue Firma'])
        self.assertEqual(state['search']['criteria'], criteria)
        self.assertEqual({row['id'] for row in state['notifications']}, {first_id, second_id})
        self.assertEqual({row['kind'] for row in state['events']}, {'company', 'signal', 'contact', 'qualification'})
        through = state['events'][0]['id']
        with app.db() as c:
            lead_search._event(c, first_id, 'example.com', 'signal', 'Nowsza informacja', 'nowy argument')
        finder.mark('read', {'id': first_id, 'through': through})
        remaining = finder.state(first_id)
        self.assertEqual(next(row for row in remaining['notifications'] if row['id'] == first_id)['count'], 1)
        self.assertTrue(all(not row['unread'] for row in remaining['events'][1:]))

    def test_simulation_and_project_boundary(self):
        finder = app.lead_finder
        with patch('languages.data_simulation', return_value=True):
            result = finder.create({'query': 'Acme'})
            self.assertEqual(result['jobs'], [])
            self.assertFalse(finder.run_one())
        search_id = result['search']['id']
        self.assertEqual([row['name'] for row in result['companies']], ['Acme'])
        shared_project.create(app.db, {'name': 'Inny projekt'})
        with self.assertRaisesRegex(ValueError, 'aktywnym projekcie'):
            finder.state(search_id)

    def test_stop_all_cancels_jobs_across_projects_and_discards_late_results(self):
        finder = app.lead_finder
        with app.db() as c:
            c.execute("""UPDATE seller_projects SET data=json_set(data,'$.signal_interests',json('["it_hiring"]'))
                WHERE id=1""")
        with patch('ai_service.ready', return_value=True), patch('languages.data_simulation', return_value=False):
            first = finder.create({'query':'Acme'})['search']['id']
            second = finder.create({'query':'Acme developer'})['search']['id']
            running = finder.claim()
            self.assertEqual((running['kind'], running['search_id']),('discover',first))
            shared_project.create(app.db,{'name':'Inny projekt'})
            self.assertIsNone(finder.state()['search'])
            self.assertGreater(finder.state()['active_agent_jobs'],0)
            third = finder.create({'query':'Acme in another project'})['search']['id']
            active_jobs = finder.state()['active_agent_jobs']
            self.assertEqual(finder.stop_all(), {'stopped_searches':3,'stopped_jobs':active_jobs})
            self.assertGreater(finder.state(third)['search']['stopped'],0)
            shared_project.select(app.db,{'project_id':1})
            stopped = finder.state(first)
            self.assertEqual([row['status'] for row in stopped['companies']],['cancelled'])
            finder.finish(running, ([], [{'name':'Late result','domain':'late.example','origin':'agent'}]))
            data = finder.state(first)
            self.assertEqual([row['domain'] for row in data['companies']],['example.com'])
            self.assertFalse(any(row['status'] in lead_search.ACTIVE for row in data['jobs']))
            self.assertEqual({row['kind'] for row in finder.state(second)['jobs'] if row['status']=='cancelled'},
                             {'discover','research','signals'})
            self.assertEqual(finder.stop_all(), {'stopped_searches':0,'stopped_jobs':0})
            self.assertEqual(finder.state(first)['search']['stopped'],stopped['search']['stopped'])
            self.assertIsNone(finder.claim())
            new = finder.create({'query':'Acme opnieuw'})['search']['id']
            self.assertEqual({row['kind'] for row in finder.state(new)['jobs'] if row['status']=='pending'},
                             {'discover','research','signals'})

    def test_requires_exact_source_for_each_required_criterion(self):
        criteria = [{'label': 'Technologia', 'alternatives': ['PLC', 'MES']},
                    {'label': 'Kraj', 'alternatives': ['Niemcy']}]
        pages = [{'url': 'https://example.com/', 'text': 'Modernizujemy sterowniki PLC w Linzu.', 'observed': 1}]
        actual = {'source': 0, 'criterion': 0, 'quote': 'Modernizujemy sterowniki PLC', 'result': 'confirmed'}
        invented = {'source': 0, 'criterion': 1, 'quote': 'Działamy w Niemczech', 'result': 'confirmed'}
        status, evidence, contact = lead_search._assess(criteria, pages, {'evidence': [actual, invented]})
        self.assertEqual((status, len(evidence), contact), ('uncertain', 1, ''))

    def test_discover_updates_pause_only_signal_jobs_and_discard_late_results(self):
        finder = app.lead_finder
        with app.db() as c:
            c.execute("""UPDATE seller_projects SET data=json_set(data,'$.signal_interests',json('["it_hiring"]'))
                WHERE id=1""")
        def set_updates(enabled):
            return finder.set_signal_updates({'project_id':1,'enabled':enabled})
        with patch('ai_service.ready', return_value=True), patch('languages.data_simulation', return_value=False):
            first = finder.create({'query':'Acme'})['search']['id']
            finder.finish(finder.claim(),([],[]))
            finder.finish(finder.claim(),([],{}))
            finder.finish(finder.claim(),('uncertain',[],''))
            running = finder.claim()
            self.assertEqual(running['kind'],'signals')
            self.assertEqual(set_updates(False),{'enabled':False})
            late = dict(kind='it_hiring',title='Late result',url='https://example.com/',quote='A job posting',
                        source_date=datetime.now(timezone.utc).date().isoformat(),date_kind='publication')
            finder.finish(running,([late],0))
            paused = finder.state(first)
            self.assertFalse(paused['signal_updates_enabled'])
            self.assertEqual(paused['companies'][0]['signals'],[])
            self.assertEqual(paused['companies'][0]['signal_checks'][0]['status'],'paused')
            self.assertEqual(paused['active_agent_jobs'],0)
            with self.assertRaisesRegex(ValueError,'Włącz aktualizacje'):
                finder.check_signals({'id':first})
            second = finder.create({'query':'Acme automation'})['search']['id']
            jobs = {job['kind']:job['status'] for job in finder.state(second)['jobs']}
            self.assertEqual(jobs,{'research':'done','evaluate':'pending','signals':'paused','discover':'pending'})
            shared_project.create(app.db,{'name':'Inny projekt'})
            self.assertTrue(finder.state()['signal_updates_enabled'])
            shared_project.select(app.db,{'project_id':1})
            set_updates(True)
            self.assertIn('pending',[job['status'] for job in finder.state(first)['jobs'] if job['kind']=='signals'])
            set_updates(False)
            finder.stop_all()
            set_updates(True)
            self.assertIsNone(finder.claim())

    def test_project_signals_share_a_job_and_update_each_search(self):
        finder = app.lead_finder
        with app.db() as c:
            c.execute("UPDATE seller_projects SET data=json_set(data,'$.signal_interests',json(?)) WHERE id=1",
                      (json.dumps(['it_hiring', 'erp', 'pricing_visit']),))
        signal = {'kind':'it_hiring', 'title':'Rekrutacja programisty', 'url':'https://example.com/jobs',
                  'quote':'Acme hires a developer.', 'source_date':datetime.now(timezone.utc).date().isoformat(),
                  'date_kind':'publication', 'observed':1}
        def analyze_type(service, job):
            with service.db() as c:
                kinds = json.loads(c.execute('SELECT kinds FROM lead_signal_runs WHERE id=?',
                                             (job['search_id'],)).fetchone()[0])
            return ([signal] if kinds == ['it_hiring'] else [], 0)

        with (
            patch('ai_service.ready', return_value=True),
            patch('languages.data_simulation', return_value=False),
            patch.object(finder, 'discover', return_value=([], [])),
            patch.object(finder, 'research', return_value=[{'text':'Acme hires a developer.'}]),
            patch.object(finder, 'evaluate', return_value=('uncertain', [], '')),
            patch('lead_signals.analyze', side_effect=analyze_type) as analyze,
        ):
            first = finder.create({'query':'Acme'})['search']['id']
            second = finder.create({'query':'Acme developer'})['search']['id']
            while finder.run_one():
                pass
        self.assertEqual(analyze.call_count, 2)
        for search in (first, second):
            data = finder.state(search)
            self.assertEqual([row['key'] for row in data['signal_types']], ['erp', 'it_hiring', 'pricing_visit'])
            self.assertEqual(data['companies'][0]['signals'][0]['title'], signal['title'])
            self.assertEqual({row['kind']:row['status'] for row in data['companies'][0]['signal_checks']},
                             {'erp':'unconfirmed','it_hiring':'confirmed','pricing_visit':'requires_source'})
            self.assertEqual({job['signal_kind'] for job in data['jobs'] if job['kind'] == 'signals'}, {'erp','it_hiring'})
            self.assertEqual([event['kind'] for event in data['events']], ['signal'])

    def test_browser_claim_routes_research_and_returns_verified_html(self):
        finder = app.lead_finder
        done = threading.Event()
        parsed = {'text':'This website provides public company information.', 'blocked':False, 'links':[]}
        original = finder.execute

        def execute(job):
            try:
                original(job)
            finally:
                done.set()

        with (
            patch('ai_service.ready', return_value=True),
            patch('languages.data_simulation', return_value=False),
            patch.object(finder, 'discover', return_value=([], [])),
            patch.object(finder, 'browser_reader', return_value=parsed) as browser,
            patch('public_data.fetch_public', return_value=('<body>Example public page</body>', 'https://example.com/')),
            patch.object(finder, 'execute', side_effect=execute),
        ):
            search = finder.create({'query':'Acme'})['search']['id']
            finder.run_one()
            done.clear()
            finder.browser_tick()
            self.assertTrue(done.wait(5))
        browser.assert_called_once()
        self.assertEqual(browser.call_args.args[0]['method'], 'research')
        job = next(row for row in finder.state(search)['jobs'] if row['kind']=='research')
        self.assertEqual((job['executor'], job['status']), ('chrome','done'))

    def test_signal_verification_requires_an_actual_date_and_source(self):
        publication = 'https://example.com/jobs/'
        body = 'Acme zatrudnia programistę C#. Opublikowano 10 listopada 2026.'
        row = {'kind':'it_hiring','source_url':publication,'quote':'Acme zatrudnia programistę C#.',
               'date_quote':'10 listopada 2026','source_date':'2026-11-10','date_kind':'publication','title':'Rekrutacja C#'}
        with patch('opportunity_discovery.read_publication', return_value={'url':publication,'body':body}):
            signal = lead_signals.verify(row,'example.com',['Acme'],['it_hiring'],{publication},{},date(2026,11,17))
            self.assertEqual(signal['source_date'],'2026-11-10')
            with self.assertRaisesRegex(ValueError, 'cytatu lub daty'):
                lead_signals.verify({**row,'source_date':'2026-11-11'},'example.com',['Acme'],['it_hiring'],
                                    {publication},{},date(2026,11,17))

    def test_restart_splits_pending_batches_saved_by_the_old_scheduler(self):
        finder = app.lead_finder
        with patch('ai_service.ready', return_value=True), patch('languages.data_simulation', return_value=False):
            search = finder.create({'query':'Acme'})['search']['id']
        with app.db() as c:
            old_run = c.execute("INSERT INTO lead_signal_runs(project_id,domain,kinds) VALUES(1,'example.com',?)",
                                (json.dumps(['erp','it_hiring']),)).lastrowid
            c.execute('INSERT INTO lead_signal_subscriptions VALUES(?,?)', (old_run,search))
            lead_search._job(c,1,'signals',old_run,'example.com')
        app.init()
        jobs = [job for job in finder.state(search)['jobs'] if job['kind'] == 'signals']
        self.assertEqual({(job['signal_kind'],job['status']) for job in jobs},
                         {('erp','pending'),('it_hiring','pending')})

    def test_discovery_appends_distinct_batches_until_the_requested_limit(self):
        finder = app.lead_finder
        candidates = [{'origin':'agent', 'name':f'Firma {index}', 'domain':f'firma{index}.example',
                       'url':'', 'snippet':''} for index in range(6)]
        with (
            patch('ai_service.ready', return_value=True),
            patch('languages.data_simulation', return_value=False),
            patch.object(finder,'discover', side_effect=[([],candidates[:3]),([],candidates[2:])]) as discover,
        ):
            search = finder.create({'query':'Przemysł','company_limit':5})['search']['id']
            finder.run_one()
            self.assertEqual(len(finder.state(search)['companies']),3)
            finder.run_one()
        result = finder.state(search)
        self.assertEqual(len(result['companies']),5)
        self.assertEqual(discover.call_count,2)
        self.assertTrue(all(job['status']=='done' for job in result['jobs'] if job['kind']=='discover'))

    def test_malformed_agent_payload_is_retried_with_readable_error(self):
        finder = app.lead_finder
        with (
            patch('ai_service.ready', return_value=True),
            patch('languages.data_simulation', return_value=False),
            patch.object(finder,'discover', side_effect=lambda _:app.ai_service.decode_result('[] []',list)),
        ):
            search = finder.create({'query':'Przemysł'})['search']['id']
            finder.run_one()
        job = next(job for job in finder.state(search)['jobs'] if job['kind']=='discover')
        self.assertEqual(job['status'],'pending')
        self.assertEqual(job['detail'],'AI zwróciło wynik w nieprawidłowym formacie.')

    def test_signal_queue_rotates_between_searches_with_pending_work(self):
        finder = app.lead_finder
        with patch('ai_service.ready', return_value=True), patch('languages.data_simulation', return_value=False):
            first = finder.create({'query':'transport'})['search']['id']
            second = finder.create({'query':'rekrutacja'})['search']['id']
        with app.db() as c:
            for search_id, domain in ((first,'first.example'),(second,'second.example')):
                search = c.execute('SELECT * FROM lead_searches WHERE id=?', (search_id,)).fetchone()
                lead_signals.schedule(c,search,domain,['erp','it_hiring'])
            c.execute("UPDATE lead_search_jobs SET status='done' WHERE kind!='signals'")
        self.assertEqual([finder.claim()['domain'] for _ in range(4)],
                         ['first.example','second.example','first.example','second.example'])

    def test_offer_word_alone_cannot_surface_a_local_result(self):
        unrelated = {'name':'SICK','domain':'sick.example','location':'','snippet':'Dopasowanie do oferty systemów PLC'}
        relevant = {'name':'Agencja Y','domain':'agency.example','location':'','snippet':'Usługi rekruterskie dla przemysłu'}
        with app.db() as c, patch('lead_search._project_rows', return_value=[unrelated,relevant]):
            rows = lead_search._local(c,1,'firmy rekruterskie ktore maja aktywne oferty')
        self.assertEqual([row['domain'] for row in rows], ['agency.example'])
