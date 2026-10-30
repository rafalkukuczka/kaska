import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import app
import discover_contacts
import languages
import opportunity_discovery as od
import shared_project
import test_app


class OpportunityDiscoveryTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def setup_search(self,**fields):
        shared_project.save(app.db,{'offer':'Industrial integration services','audience':'Manufacturers',
            'signal_interests':['new_factory','hiring'],**fields})
        self.manager=od.Discovery(app.db)
        with patch('opportunity_discovery.ai_service.ready',return_value=True),patch('opportunity_discovery.threading.Thread'):
            run=self.manager.start({})
        self.project=shared_project.get(app.db)
        with app.db() as c:self.request=json.loads(c.execute('SELECT request FROM opportunity_searches WHERE id=?',(run['id'],)).fetchone()[0])
        self.groups={}
        for key in self.project['signal_interests']:
            self.groups.setdefault(od.CATALOG[key]['category'],[]).append(od.CATALOG[key])
        return run['id']

    def row(self,key='new_factory',**changes):
        day=datetime.now(timezone.utc).date().isoformat()
        return {'kind':key,'company':'Acme','title':'Acme business event','summary':'Acme announced an expansion.',
            'source_url':'https://news.example/'+key,'quote':'Acme announced '+key+' on '+day+'.',
            'event_date':day,'date_quote':day,'published_date':day,'published_quote':day,
            'relevance':80,'reason':'This may create demand for integration services; verify the hypothesis.',
            'website':'https://acme.example/','location':'Berlin','duplicate_id':None,**changes}

    def response(self,key='new_factory',**changes):
        row=self.row(key,**changes)
        return {'data':{'opportunities':json.dumps([row])},'sources':[row['source_url'],'https://acme.example/']}

    def fetch(self,url):
        if url=='https://acme.example/':return '<main>Acme manufactures industrial products and operates several production plants across Europe.</main>',url
        day=datetime.now(timezone.utc).date().isoformat()
        body=' '.join('Acme announced '+key+' on '+day+'.' for key in ('new_factory','hiring'))
        return '<main>'+body+' <a href="https://acme.example/">Acme website</a></main>',url

    def execute(self,run,generate=None):
        def default(instructions,data,fields,**kwargs):return self.response(data['selected_types'][0]['key'])
        with patch('opportunity_discovery.ai_service.generate_json',side_effect=generate or default),patch('opportunity_discovery.content_library.fetch_public',side_effect=self.fetch):
            self.manager.execute(run,self.project,self.groups,self.request)
        return self.manager.state(self.project['id'])

    def test_selected_categories_find_verified_opportunities_without_outreach_or_project_changes(self):
        run=self.setup_search(search_languages=['pl','de'],search_areas=[{'lat':52.5,'lng':13.4,'radius_km':100,'label':'Berlin'}])
        before=shared_project.get(app.db);calls=[]
        def generate(instructions,data,fields,**kwargs):
            calls.append((data,kwargs));return self.response(data['selected_types'][0]['key'])
        result=self.execute(run,generate)
        self.assertEqual(result['runs'][0]['status'],'completed');self.assertEqual(len(result['items']),2)
        self.assertEqual({row['category'] for row in result['items']},{'Ekspansja','Zespół'})
        self.assertTrue(all(row['domain']=='acme.example' for row in result['items']))
        self.assertEqual(len(calls),2)
        for data,kwargs in calls:
            self.assertTrue(kwargs['web_search']);self.assertEqual(data['offer'],before['offer'])
            self.assertEqual(data['search_languages'],['pl','de']);self.assertEqual(data['search_areas'],before['search_areas'])
        self.assertEqual(shared_project.get(app.db),before)
        self.assertFalse(self.manager.lock.locked())
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)

    def test_invalid_or_unsourced_or_old_results_are_not_saved(self):
        for changes in ({'quote':'Acme invented quote'}, {'company':'Unmentioned'}, {'kind':'funding'},
                        {'event_date':'','published_date':''}, {'event_date':'2020-01-01','published_date':'2020-01-01'},
                        {'date_quote':'Absent date'}, {'relevance':True}):
            with self.subTest(changes=changes):
                run=self.setup_search(signal_interests=['new_factory'])
                result=self.execute(run,lambda *args,**kwargs:self.response(**changes))
                self.assertEqual(result['items'],[]);self.assertTrue(result['runs'][0]['warnings'])
        run=self.setup_search(signal_interests=['new_factory'])
        result=self.execute(run,lambda *args,**kwargs:{'data':{'opportunities':json.dumps([self.row()])},'sources':['https://other.example/']})
        self.assertEqual(result['items'],[])

    def test_repeated_search_deduplicates_and_merges_supported_publications(self):
        first=self.setup_search(signal_interests=['new_factory']);self.execute(first)
        again=self.setup_search(signal_interests=['new_factory']);result=self.execute(again)
        self.assertEqual(len(result['items']),1);self.assertEqual(result['runs'][0]['added'],0)
        duplicate_id=result['items'][0]['id']
        third=self.setup_search(signal_interests=['new_factory'])
        result=self.execute(third,lambda *a,**kw:self.response(source_url='https://news.example/another',duplicate_id=duplicate_id))
        self.assertEqual(len(result['items']),1);self.assertEqual(len(result['items'][0]['sources']),2)

    def test_same_company_different_event_date_does_not_merge(self):
        run=self.setup_search(signal_interests=['new_factory']);result=self.execute(run)
        duplicate=result['items'][0]['id']
        yesterday=(datetime.now(timezone.utc).date()-timedelta(days=1)).isoformat()
        run=self.setup_search(signal_interests=['new_factory'])
        original=self.fetch
        def fetch(url):
            body,final=original(url);return body.replace('</main>',yesterday+'</main>'),final
        with patch.object(self,'fetch',side_effect=fetch):
            result=self.execute(run,lambda *a,**kw:self.response(source_url='https://news.example/another',event_date=yesterday,date_quote=yesterday,duplicate_id=duplicate))
        self.assertEqual(len(result['items']),2)

    def test_empty_search_is_valid_and_partial_category_failures_keep_results(self):
        run=self.setup_search()
        def generate(instructions,data,*args,**kwargs):
            if data['selected_types'][0]['key']=='hiring':raise ValueError('OpenAI limit')
            return self.response()
        result=self.execute(run,generate)
        self.assertEqual(len(result['items']),1);self.assertEqual(result['runs'][0]['status'],'partial')
        run=self.setup_search()
        result=self.execute(run,lambda *a,**kw:{'data':{'opportunities':'[]'},'sources':[]})
        self.assertEqual(result['runs'][0]['status'],'completed');self.assertEqual(result['runs'][0]['added'],0)

    def test_cancel_during_web_search_stops_fetches_and_further_categories(self):
        run=self.setup_search();calls=[]
        def generate(*args,**kwargs):
            calls.append(1);self.manager.cancel({'id':run});return self.response()
        result=self.execute(run,generate)
        self.assertEqual(len(calls),1);self.assertEqual(result['runs'][0]['status'],'cancelled');self.assertEqual(result['items'],[])
        self.assertFalse(self.manager.lock.locked())

    def test_project_changes_stop_stale_search_without_overwriting_offer(self):
        run=self.setup_search()
        def generate(*args,**kwargs):
            shared_project.save(app.db,{'offer':'Changed offering'});return self.response()
        result=self.execute(run,generate)
        self.assertEqual(result['runs'][0]['status'],'stale');self.assertEqual(result['items'],[])
        self.assertEqual(shared_project.get(app.db)['offer'],'Changed offering')

    def test_background_search_remains_owned_by_original_project(self):
        run=self.setup_search();first=self.project
        other=shared_project.create(app.db,{'name':'Private'})
        with self.assertRaises(ValueError):self.manager.cancel({'id':run,'project_id':other['id']})
        result=self.execute(run)
        self.assertEqual(len(result['items']),2);self.assertEqual(self.manager.state(other['id'])['items'],[])
        self.assertEqual(self.manager.state(first['id'])['runs'][0]['id'],run)

    def test_new_company_is_available_for_contact_lookup_without_saving_contacts(self):
        run=self.setup_search();self.execute(run)
        with patch('discover_contacts.Hunter') as hunter:
            hunter.return_value.request.return_value={'data':{'domain':'acme.example','organization':'Acme','emails':[]}}
            result=app.discover_contact_finder.search({'company':'Acme','domain':'acme.example'})
        self.assertEqual(result['domain'],'acme.example')
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)

    def test_manual_search_requires_ai_offer_and_selection_and_never_schedules_itself(self):
        manager=od.Discovery(app.db)
        with self.assertRaises(ValueError):manager.start({})
        with patch('opportunity_discovery.ai_service.ready',return_value=True):
            with self.assertRaises(ValueError):manager.start({})
            shared_project.save(app.db,{'signal_interests':['funding']})
            with self.assertRaises(ValueError):manager.start({})
            shared_project.save(app.db,{'offer':'An offering'})
            languages.save_data_simulation(app.db,{'enabled':True})
            with self.assertRaises(ValueError):manager.start({})
        self.assertFalse(hasattr(manager,'worker'));self.assertFalse(hasattr(manager,'tick'))

    def test_website_is_not_confirmed_without_evidence_of_company_identity(self):
        run=self.setup_search(signal_interests=['new_factory'])
        result=self.execute(run,lambda *args,**kwargs:self.response(website='https://unrelated.example/'))
        self.assertEqual(result['items'][0]['domain'],'')

    def test_restart_marks_inflight_work_interrupted_without_repeating_calls(self):
        run=self.setup_search()
        self.manager.lock.release()
        with patch('ai_service.generate_json') as ai:
            with app.db() as c:od.init_schema(c)
            ai.assert_not_called()
        self.assertEqual(self.manager.state(self.project['id'])['runs'][0]['status'],'interrupted')

    def test_cancel_retains_already_saved_category(self):
        run=self.setup_search();calls=[]
        def generate(instructions,data,*args,**kwargs):
            calls.append(1)
            if len(calls)==2:self.manager.cancel({'id':run})
            return self.response(data['selected_types'][0]['key'])
        result=self.execute(run,generate)
        self.assertEqual(result['runs'][0]['status'],'cancelled')
        self.assertEqual(len(result['items']),1);self.assertEqual(result['runs'][0]['added'],1)

    def test_expired_results_remain_in_history_but_leave_last_30_days_view(self):
        run=self.setup_search();self.execute(run)
        old=(datetime.now(timezone.utc).date()-timedelta(days=40)).isoformat()
        with app.db() as c:c.execute('UPDATE discovered_opportunities SET published_date=?',(old,))
        self.assertEqual(self.manager.state(self.project['id'])['items'],[])
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM discovered_opportunities').fetchone()[0],2)

    def test_date_quote_must_support_the_actual_date_not_just_exist(self):
        today=datetime.now(timezone.utc).date()
        self.assertTrue(od.supports_date(today,today.isoformat()))
        self.assertFalse(od.supports_date(today,'2020-01-01'))
        self.assertTrue(od.supports_date(datetime(2026,10,30).date(),'30 października 2026'))
        self.assertTrue(od.supports_date(datetime(2026,10,30).date(),'October 30, 2026'))
