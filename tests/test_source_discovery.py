import json
import io
import threading
import time
import unittest
from unittest.mock import patch

import test_app
import app
import source_discovery as discovery
import ai_service


class DiscoveryTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def setup_company(self):
        self.manager=discovery.Discovery(app.signal_engine,app.db)
        with app.db() as c:c.execute("UPDATE contacts SET email='anna@acme.example' WHERE id=1")
        return {'companies':['Acme'],'offer':'Sales automation','audience':'Retail','language':'pl'}

    def found(self):
        return {'data':{'website':'https://acme.example/','career':'https://acme.example/careers',
            'rss':'https://acme.example/feed.xml','greenhouse':'https://job-boards.greenhouse.io/acme',
            'lever':'https://jobs.eu.lever.co/acme','signal_kinds':'funding,it_hiring','identity':'matched','reason':'Company identity matches the domain.'},
            'sources':['https://acme.example/','https://job-boards.greenhouse.io/acme']}

    def fetch(self,url):
        pages={'https://acme.example/':'<title>Acme</title><main>Acme logistics services</main><a href="/careers">Careers</a><link rel="alternate" type="application/rss+xml" href="/feed.xml">',
            'https://acme.example/careers':'<main>Acme careers</main><a href="https://job-boards.greenhouse.io/acme">Greenhouse</a><a href="https://jobs.eu.lever.co/acme">Lever</a>',
            'https://acme.example/feed.xml':'<rss version="2.0"><channel><title>Acme news</title></channel></rss>'}
        if url not in pages:raise ValueError('Unexpected URL: '+url)
        return pages[url],url

    def execute(self,request,found=None):
        with app.db() as c:
            job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',?,?,?,?)",(len(request['companies']),json.dumps(request),time.time(),time.time())).lastrowid
        self.manager.lock.acquire()
        with patch('source_discovery.ai_service.generate_json',return_value=found or self.found()) as generate,patch('source_discovery.ss.fetch_public',side_effect=self.fetch),patch('source_discovery.data_connectors.load',return_value={'items':[]}):
            self.manager.execute(job_id,request)
        return self.manager.state()['jobs'][0],generate

    def test_verified_sources_are_added_with_filters_and_clickable_provenance(self):
        request=self.setup_company()
        job,generate=self.execute(request)
        self.assertEqual((job['status'],job['completed']),('completed',1))
        sources=app.signal_engine.state()['sources']
        self.assertEqual(len(sources),7)
        self.assertTrue(all(not source['auto_accept'] for source in sources))
        self.assertTrue(all(json.loads(source['signal_kinds'])==['funding','it_hiring'] for source in sources))
        self.assertIn('https://acme.example/',job['results'][0]['citations'])
        self.assertEqual({row['status'] for row in job['results'][0]['entries']},{'added'})
        self.assertTrue(generate.call_args.kwargs['web_search'])
        sent=generate.call_args.args[1]
        self.assertEqual(sent['domain_hints'],['acme.example'])
        self.assertNotIn('anna@',json.dumps(sent))
        again,_=self.execute(request)
        self.assertEqual(len(app.signal_engine.state()['sources']),7)
        self.assertEqual({row['status'] for row in again['results'][0]['entries']},{'existing'})

    def test_namesake_or_mismatched_contact_domain_requires_review(self):
        request=self.setup_company()
        with app.db() as c:c.execute("UPDATE contacts SET email='anna@other.example' WHERE id=1")
        job,_=self.execute(request)
        self.assertEqual({s['kind'] for s in app.signal_engine.state()['sources']},{'google_news','gdelt'})
        self.assertTrue(all(row['status']=='review' for row in job['results'][0]['entries'] if row['kind'] not in ('google_news','gdelt')))

    def test_existing_root_without_slash_is_reused_and_pause_and_acceptance_are_preserved(self):
        request=self.setup_company()
        source_id=app.signal_engine.source({'company':'Acme','kind':'page','name':'Existing','url':'https://acme.example','auto_accept':True})
        app.signal_engine.post('source/status',{'id':source_id,'enabled':False})
        self.execute(request)
        sources=app.signal_engine.state()['sources']
        self.assertEqual(len(sources),7)
        existing=next(s for s in sources if s['id']==source_id)
        self.assertFalse(existing['enabled'])
        self.assertTrue(existing['auto_accept'])
        self.assertEqual(json.loads(existing['signal_kinds']),['funding','it_hiring'])

    def test_ai_does_not_restore_deleted_sources(self):
        request=self.setup_company()
        source_id=app.signal_engine.source({'company':'Acme','kind':'page','name':'Deleted','url':'https://acme.example'})
        app.signal_engine.delete_source(source_id)
        job,_=self.execute(request)
        entry=next(row for row in job['results'][0]['entries'] if row['url']=='https://acme.example/')
        self.assertEqual(entry['status'],'review')
        self.assertFalse(any(s['url']=='https://acme.example/' for s in app.signal_engine.state()['sources']))

    def test_uncertain_identity_does_not_auto_configure_sources(self):
        request=self.setup_company();found=self.found();found['data']['identity']='uncertain'
        job,_=self.execute(request,found)
        self.assertEqual({s['kind'] for s in app.signal_engine.state()['sources']},{'google_news','gdelt'})
        self.assertEqual(job['status'],'completed')

    def test_search_only_board_not_linked_by_official_site_is_review_only(self):
        request=self.setup_company();found=self.found();found['data']['greenhouse']='https://job-boards.greenhouse.io/wrong'
        job,_=self.execute(request,found)
        wrong=next(row for row in job['results'][0]['entries'] if row['kind']=='greenhouse')
        self.assertEqual(wrong['status'],'review')
        self.assertFalse(any('/wrong/' in row['url'] for row in app.signal_engine.state()['sources']))

    def test_website_without_search_provenance_is_not_fetched(self):
        request=self.setup_company();found=self.found();found['sources']=['https://other.example/']
        job,_=self.execute(request,found)
        self.assertEqual({s['kind'] for s in app.signal_engine.state()['sources']},{'google_news','gdelt'})
        self.assertEqual(job['status'],'completed')

    def test_non_feed_response_is_not_added_as_rss(self):
        request=self.setup_company();original=self.fetch
        def fetch(url):
            if url.endswith('feed.xml'):return '<html>Not a feed</html>',url
            return original(url)
        with patch.object(self,'fetch',side_effect=fetch):job,_=self.execute(request)
        self.assertEqual(next(row for row in job['results'][0]['entries'] if row['kind']=='rss')['status'],'review')

    def test_missing_api_and_unknown_companies_fail_before_start(self):
        self.setup_company()
        with self.assertRaises(ValueError):self.manager.start({})
        with patch('source_discovery.ai_service.ready',return_value=True):
            for companies in ([],['Unknown'],['Acme']*51):
                with self.assertRaises(ValueError):self.manager.start({'companies':companies})
        self.assertEqual(self.manager.state()['jobs'],[])

    def test_start_returns_while_ai_waits_and_cancel_discards_current_company(self):
        self.setup_company();entered,release=threading.Event(),threading.Event()
        def search(*args,**kwargs):
            entered.set()
            if not release.wait(5):raise ValueError('Test timeout')
            return self.found()
        with patch('source_discovery.ai_service.ready',return_value=True),patch('source_discovery.ai_service.generate_json',side_effect=search),patch('source_discovery.ss.fetch_public',side_effect=self.fetch),patch('source_discovery.data_connectors.load',return_value={'items':[]}):
            try:
                result=self.manager.start({'companies':['Acme']})
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.manager.state()['jobs'][0]['status'],'running')
                with self.assertRaises(ValueError):self.manager.start({'companies':['Acme']})
                self.manager.cancel(result['id'])
            finally:
                release.set()
                acquired=self.manager.lock.acquire(timeout=5)
                if acquired:self.manager.lock.release()
        self.assertTrue(acquired)
        self.assertEqual(self.manager.state()['jobs'][0]['status'],'cancelled')
        self.assertEqual(app.signal_engine.state()['sources'],[])

    def test_cancel_is_idempotent_and_ai_failure_cannot_override_it(self):
        self.setup_company();entered,release=threading.Event(),threading.Event()
        def search(*args,**kwargs):
            entered.set()
            if not release.wait(5):raise ValueError('Test timeout')
            raise ValueError('Provider failure after cancellation')
        with patch('source_discovery.ai_service.ready',return_value=True),patch('source_discovery.ai_service.generate_json',side_effect=search):
            try:
                result=self.manager.start({'companies':['Acme']})
                self.assertTrue(entered.wait(2))
                self.manager.cancel(result['id'])
                self.assertEqual(self.manager.cancel(result['id']),{'ok':True})
            finally:
                release.set()
                acquired=self.manager.lock.acquire(timeout=5)
                if acquired:self.manager.lock.release()
        self.assertTrue(acquired)
        job=self.manager.state()['jobs'][0]
        self.assertEqual((job['status'],job['error']),('cancelled',''))

    def test_stop_keeps_completed_company_results_and_skips_later_companies(self):
        request=self.setup_company();request['companies']=['Acme','Second','Third']
        with app.db() as c:job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',3,?,?,?)",(json.dumps(request),time.time(),time.time())).lastrowid
        calls=[]
        def discover(job_id,company,request):
            calls.append(company)
            if company=='Second':
                self.manager.cancel(job_id)
                raise discovery.Cancelled()
            entry={'kind':'google_news','url':'','status':'review','reason':'Verified fixture'}
            values=app.signal_engine.source_values({'company':company,'kind':'google_news'})
            return {'company':company,'reason':'Fixture','signal_kinds':[],'citations':[],'entries':[entry]},[(entry,values)]
        self.manager.lock.acquire()
        with patch.object(self.manager,'discover',side_effect=discover):self.manager.execute(job_id,request)
        job=self.manager.state()['jobs'][0]
        self.assertEqual((job['status'],job['completed']),('cancelled',1))
        self.assertEqual(calls,['Acme','Second'])
        self.assertEqual(job['results'][0]['entries'][0]['status'],'added')
        self.assertEqual(len(app.signal_engine.state()['sources']),1)

    def test_restart_marks_jobs_interrupted_without_repeating_requests(self):
        request=self.setup_company()
        with app.db() as c:c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',1,?,?,?)",(json.dumps(request),time.time(),time.time()))
        with patch('source_discovery.ai_service.generate_json') as generate:
            app.init();generate.assert_not_called()
        self.assertEqual(self.manager.state()['jobs'][0]['status'],'interrupted')

    def test_provider_failure_is_review_only_and_retains_other_valid_sources(self):
        request=self.setup_company()
        with patch('source_discovery.data_connectors.load',side_effect=ValueError('Provider temporarily unavailable')):
            # execute() installs a provider fixture; exercise discover directly here.
            with app.db() as c:job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',1,?,?,?)",(json.dumps(request),time.time(),time.time())).lastrowid
            with patch('source_discovery.ai_service.generate_json',return_value=self.found()),patch('source_discovery.ss.fetch_public',side_effect=self.fetch):
                report,plans=self.manager.discover(job_id,'Acme',request)
        self.assertEqual(len(plans),3)
        self.assertTrue(all(entry['status']=='review' for entry in report['entries'] if entry['kind'] in ('greenhouse','lever','gdelt','google_news')))

    def test_ai_error_is_persisted_and_unlocks_next_attempt(self):
        request=self.setup_company()
        with app.db() as c:job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',1,?,?,?)",(json.dumps(request),time.time(),time.time())).lastrowid
        self.manager.lock.acquire()
        with patch('source_discovery.ai_service.generate_json',side_effect=ValueError('quota')):self.manager.execute(job_id,request)
        job=self.manager.state()['jobs'][0]
        self.assertEqual((job['status'],job['error']),('error','quota'))
        self.assertFalse(self.manager.lock.locked())

    def test_real_response_parser_accepts_missing_optional_source_urls(self):
        request=self.setup_company()
        request.update(offer='',audience='')
        data=self.found()['data'];data.update(career=None,rss='',greenhouse=None,lever='  ',signal_kinds='')
        raw={'status':'completed','output':[{'type':'web_search_call','action':{'sources':[{'url':'https://acme.example/'}]}},
            {'type':'message','content':[{'type':'output_text','text':json.dumps(data)}]}]}
        with app.db() as c:job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',1,?,?,?)",(json.dumps(request),time.time(),time.time())).lastrowid
        self.manager.lock.acquire()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'fixture'}),patch('ai_service.urllib.request.build_opener') as opener,patch('source_discovery.ss.fetch_public',side_effect=self.fetch),patch('source_discovery.data_connectors.load',return_value={'items':[]}):
            opener.return_value.open.return_value=io.BytesIO(json.dumps(raw).encode())
            self.manager.execute(job_id,request)
        job=self.manager.state()['jobs'][0]
        self.assertEqual((job['status'],job['completed']),('completed',1))
        self.assertEqual(len(app.signal_engine.state()['sources']),7)
        self.assertTrue(all(json.loads(s['signal_kinds'])==[] for s in app.signal_engine.state()['sources']))
        self.assertIn('selection_note',job['results'][0])

    def test_empty_signal_selection_does_not_discard_sources_or_reset_existing_filters(self):
        request=self.setup_company();found=self.found();found['data']['signal_kinds']=''
        source_id=app.signal_engine.source({'company':'Acme','kind':'page','name':'Existing','url':'https://acme.example/','signal_kinds':['funding']})
        job,_=self.execute(request,found)
        self.assertEqual((job['status'],job['completed']),('completed',1))
        sources=app.signal_engine.state()['sources']
        self.assertEqual(len(sources),7)
        self.assertEqual(json.loads(next(s for s in sources if s['id']==source_id)['signal_kinds']),['funding'])
        self.assertEqual(job['results'][0]['signal_kinds'],[])

    def test_blocked_corporate_site_does_not_prevent_news_sources(self):
        request=self.setup_company()
        with patch.object(self,'fetch',side_effect=ValueError('HTTP 403')):job,_=self.execute(request)
        self.assertEqual(job['status'],'completed')
        self.assertEqual({s['kind'] for s in app.signal_engine.state()['sources']},{'google_news','gdelt'})
        page=next(e for e in job['results'][0]['entries'] if e['kind']=='page')
        self.assertEqual(page['status'],'review')
        self.assertIn('403',page['reason'])
        self.assertTrue(all(not s['auto_accept'] for s in app.signal_engine.state()['sources']))

    def test_bad_company_response_is_recorded_for_review_and_next_company_is_processed(self):
        request=self.setup_company()
        with app.db() as c:app.add_contact(c,{'email':'second@acme.example','company':'Other'})
        request['companies']=['Other','Acme']
        with app.db() as c:job_id=c.execute("INSERT INTO source_discovery_jobs(status,total,request,created,updated) VALUES('running',2,?,?,?)",(json.dumps(request),time.time(),time.time())).lastrowid
        self.manager.lock.acquire()
        with patch('source_discovery.ai_service.generate_json',side_effect=[ai_service.InvalidAIOutput('Invalid reason field'),self.found()]) as generate,patch('source_discovery.ss.fetch_public',side_effect=self.fetch),patch('source_discovery.data_connectors.load',return_value={'items':[]}):
            self.manager.execute(job_id,request)
        job=self.manager.state()['jobs'][0]
        self.assertEqual((job['status'],job['completed'],generate.call_count),('completed',2,2))
        self.assertEqual(job['results'][0]['entries'][0]['status'],'review')
        self.assertEqual(len(app.signal_engine.state()['sources']),7)
