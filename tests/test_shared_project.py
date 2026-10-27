import json
import unittest
from unittest.mock import patch

import test_app
import app
import shared_project
import signal_monitoring


class SharedProjectTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_patch_persistence_explicit_clear_and_conflict(self):
        original=shared_project.get(app.db)
        saved=shared_project.save(app.db,{'website':'example.com','offer':'Services','pain_points':'Manual work','value_props':'Less work','revision':original['revision']})
        shared_project.save(app.db,{'offer':'Updated','revision':saved['revision']})
        project=shared_project.get(app.db)
        self.assertEqual((project['pain_points'],project['value_props']),('Manual work','Less work'))
        with self.assertRaises(ValueError):shared_project.save(app.db,{'offer':'Stale','revision':saved['revision']})
        self.assertEqual(shared_project.get(app.db)['offer'],'Updated')

        for item in ({'offer':None},{'pain_points':[]},{'audience':'x'*3001}):
            with self.subTest(item=item),self.assertRaises(ValueError):shared_project.save(app.db,item)
        shared_project.save(app.db,{'pain_points':''})
        self.assertEqual(shared_project.get(app.db)['pain_points'],'')
        app.init()
        self.assertEqual(shared_project.get(app.db)['offer'],'Updated')

    def test_search_languages_are_saved_per_project_and_can_be_cleared(self):
        first=shared_project.save(app.db,{'search_languages':['pl','en','pl']})
        self.assertEqual(first['search_languages'],['pl','en'])
        self.assertEqual(shared_project.resolve(app.db,{})['search_languages'],['pl','en'])
        shared_project.create(app.db,{'name':'Other'})
        self.assertEqual(shared_project.get(app.db)['search_languages'],[])
        shared_project.save(app.db,{'search_languages':['de','fr']})
        shared_project.select(app.db,{'project_id':first['id']})
        app.init()
        self.assertEqual(shared_project.get(app.db)['search_languages'],['pl','en'])
        for value in ('en',['xx'],None):
            with self.subTest(value=value),self.assertRaises(ValueError):shared_project.save(app.db,{'search_languages':value})
        shared_project.save(app.db,{'search_languages':[]})
        self.assertEqual(shared_project.get(app.db)['search_languages'],[])

    def test_one_time_migration_prefers_latest_search_to_library(self):
        with app.db() as c:
            c.execute('DELETE FROM steps')
            c.execute('DELETE FROM campaigns')
            c.execute('DELETE FROM seller_project_selection')
            c.execute('DELETE FROM seller_projects')
            c.execute('DELETE FROM seller_project')
            c.execute("INSERT INTO content_projects(website,name,offer,updated) VALUES('https://library.example','Library','Library offer',99)")
            c.execute("INSERT INTO prospect_runs(website,offer,audience,pain_points,value_props,created,updated,titles,department,company_limit,per_company,exclusions) VALUES('https://seller.example','Search offer','Retail teams','Manual work','Save time',1,2,'','',3,2,'[]')")
            shared_project.init_schema(c)
        project=shared_project.get(app.db)
        self.assertEqual((project['offer'],project['pain_points'],project['value_props']),('Search offer','Manual work','Save time'))
        shared_project.save(app.db,{'offer':'Edited'})
        app.init()
        self.assertEqual(shared_project.get(app.db)['offer'],'Edited')

    def test_projects_switch_and_preserve_independent_data_and_late_saves(self):
        first=shared_project.save(app.db,{'name':'First','offer':'Consulting','pain_points':'Manual work','value_props':'Save time'})
        second=shared_project.create(app.db,{'name':'Second'})
        self.assertEqual(second['offer'],'')
        self.assertEqual(second['pain_points'],'')
        shared_project.save(app.db,{'project_id':second['id'],'offer':'Delivery'})
        # A queued write for the previous project must not modify the newly selected one.
        shared_project.save(app.db,{'project_id':first['id'],'offer':'Late consulting update','revision':first['revision']})
        self.assertEqual(shared_project.get(app.db)['offer'],'Delivery')
        shared_project.select(app.db,{'project_id':first['id']})
        self.assertEqual(shared_project.get(app.db)['offer'],'Late consulting update')
        self.assertEqual(shared_project.get(app.db)['value_props'],'Save time')
        shared_project.select(app.db,{'project_id':second['id']})
        app.init()
        self.assertEqual(shared_project.get(app.db)['id'],second['id'])
        self.assertEqual(len(shared_project.projects(app.db)),2)
        for name in ('','x'*101,None):
            with self.subTest(name=name),self.assertRaises(ValueError):shared_project.create(app.db,{'name':name})
        with self.assertRaises(ValueError):shared_project.select(app.db,{'project_id':9999})

    def test_monitoring_and_company_assessments_belong_to_project_even_after_switch(self):
        first=shared_project.save(app.db,{'offer':'First offer'})
        app.signal_monitor.topic({'topic':'ERP'})
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP','evidence':'Acme ERP project.','url':'https://example.com/erp'})
        second=shared_project.create(app.db,{'name':'Second'})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        rows=[{'company':'Acme','quote':'Acme ERP project.','reason':'Potential ERP project.'}]
        with patch('ai_service.generate_json',return_value={'companies':json.dumps(rows)}):
            app.signal_monitor.companies({'id':signal_id,'project_id':first['id']})
        self.assertEqual(app.signal_monitor.state()['companies'],[])
        shared_project.select(app.db,{'project_id':first['id']})
        self.assertEqual(len(app.signal_monitor.state()['companies']),1)
        self.assertEqual(app.signal_monitor.state()['reviews'][0]['revision'],first['revision'])
        # The same event can have a separate assessment with a different project's offer.
        with patch('ai_service.generate_json',return_value={'companies':json.dumps([{**rows[0],'reason':'Different offer context.'}])}):
            app.signal_monitor.companies({'id':signal_id,'project_id':second['id']})
        self.assertEqual(app.signal_monitor.state()['companies'][0]['reason'],'Potential ERP project.')
        self.assertEqual(app.signal_monitor.state(second['id'])['companies'][0]['reason'],'Different offer context.')

    def test_offer_plan_created_after_switch_stays_with_originating_project(self):
        first=shared_project.save(app.db,{'offer':'First offer'})
        second=shared_project.create(app.db,{'name':'Second'})
        def generate(*args,**kwargs):
            shared_project.select(app.db,{'project_id':second['id']})
            return {'plan':json.dumps([{'topic':'ERP','signal_kinds':['erp'],'reason':'ERP work'}])}
        with patch('ai_service.generate_json',side_effect=generate):
            plan=app.signal_monitor.propose({'project_id':first['id']})
        with self.assertRaises(ValueError):app.signal_monitor.activate({'id':plan['id']})
        app.signal_monitor.activate({'id':plan['id'],'project_id':first['id']})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        self.assertEqual(len(app.signal_monitor.state(first['id'])['monitors']),1)

    def test_legacy_company_migration_preserves_data_without_recreating_cleared_results(self):
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP','evidence':'Acme ERP project.','url':'https://example.com/erp'})
        with app.db() as c:
            c.execute('DROP TABLE signal_project_companies')
            c.execute('DROP TABLE signal_company_reviews')
            c.execute("INSERT INTO signal_companies(signal_id,company,reason,quote) VALUES(?,'Acme','Legacy reason','Acme ERP project.')",(signal_id,))
            c.execute('UPDATE sales_signals SET companies_checked_at=123,companies_project_revision=0 WHERE id=?',(signal_id,))
            signal_monitoring.init_schema(c)
        state=app.signal_monitor.state()
        self.assertEqual(state['companies'][0]['reason'],'Legacy reason')
        self.assertEqual(state['reviews'][0]['checked_at'],123)
        with patch('ai_service.generate_json',return_value={'companies':'[]'}):app.signal_monitor.companies({'id':signal_id})
        app.init()
        self.assertEqual(app.signal_monitor.state()['companies'],[])

    def test_customer_search_history_is_separate_per_project(self):
        first=shared_project.get(app.db)
        second=shared_project.create(app.db,{'name':'Second'})
        with app.db() as c:
            for project in (first,second):
                c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,project_id) VALUES('https://example.com','Offer','Audience','','',1,1,'[]',1,2,?)",(project['id'],))
        self.assertEqual([r['project_id'] for r in app.prospector.state()['runs']],[second['id']])
        shared_project.select(app.db,{'project_id':first['id']})
        self.assertEqual([r['project_id'] for r in app.prospector.state()['runs']],[first['id']])

    def test_delete_active_project_switches_and_preserves_contacts_and_campaigns(self):
        first=shared_project.get(app.db)
        second=shared_project.create(app.db,{'name':'Second'})
        shared_project.save(app.db,{'offer':'Second offer'})
        selected=shared_project.delete(app.db,{'project_id':second['id']})
        self.assertEqual(selected['id'],first['id'])
        self.assertEqual([p['id'] for p in shared_project.projects(app.db)],[first['id']])
        for action in (lambda:shared_project.select(app.db,{'project_id':second['id']}),
                       lambda:shared_project.save(app.db,{'project_id':second['id'],'offer':'Late edit'})):
            with self.assertRaises(ValueError):action()
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0],1)
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
        app.init()
        self.assertEqual(len(shared_project.projects(app.db)),1)

    def test_delete_last_project_creates_empty_replacement_without_restoring_legacy_data(self):
        first=shared_project.save(app.db,{'offer':'Old offer','pain_points':'Old pain'})
        selected=shared_project.delete(app.db,{'project_id':first['id']})
        self.assertNotEqual(selected['id'],first['id'])
        self.assertTrue(all(not selected[field] for field in shared_project.FIELDS))
        app.init()
        self.assertEqual(shared_project.get(app.db)['id'],selected['id'])
        self.assertEqual(shared_project.get(app.db)['offer'],'')

    def test_delete_project_pauses_exclusive_sources_and_retains_shared_sources(self):
        first=shared_project.get(app.db)
        app.signal_monitor.topic({'topic':'ERP'})
        app.signal_monitor.topic({'topic':'NIS2'})
        second=shared_project.create(app.db,{'name':'Second'})
        app.signal_monitor.topic({'topic':'ERP'})
        shared_project.delete(app.db,{'project_id':first['id']})
        self.assertEqual(shared_project.get(app.db)['id'],second['id'])
        sources=app.signal_engine.state()['sources']
        self.assertTrue(all(s['enabled'] for s in sources if json.loads(s['config'])['topic']=='ERP'))
        self.assertTrue(all(not s['enabled'] for s in sources if json.loads(s['config'])['topic']=='NIS2'))
        self.assertEqual(len(app.signal_monitor.state()['monitors']),1)
        with app.db() as c:self.assertFalse(c.execute("SELECT 1 FROM signal_monitors WHERE project_id=? AND status='active'",(first['id'],)).fetchone())

    def test_delete_rejects_busy_search_and_late_ai_cannot_restore_deleted_project(self):
        project=shared_project.get(app.db)
        with app.db() as c:
            run_id=c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,project_id) VALUES('https://example.com','Offer','Audience','','',1,1,'[]',1,2,?)",(project['id'],)).lastrowid
        with self.assertRaises(ValueError):shared_project.delete(app.db,{'project_id':project['id']})
        self.assertEqual(shared_project.get(app.db)['id'],project['id'])
        with app.db() as c:c.execute("UPDATE prospect_runs SET status='completed' WHERE id=?",(run_id,))
        def generate(*args,**kwargs):
            shared_project.delete(app.db,{'project_id':project['id']})
            return {'plan':json.dumps([{'topic':'ERP','signal_kinds':['erp'],'reason':'ERP work'}])}
        shared_project.save(app.db,{'offer':'Old offer'})
        with patch('ai_service.generate_json',side_effect=generate),self.assertRaises(ValueError):
            app.signal_monitor.propose({'project_id':project['id']})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])

    def test_shared_context_used_by_offer_plan_and_company_assessment(self):
        shared_project.save(app.db,{'offer':'ERP support','audience':'Manufacturers','pain_points':'Manual planning','value_props':'Faster planning'})
        plan=[{'topic':'ERP','signal_kinds':['erp'],'reason':'Implementation demand'}]
        with patch('ai_service.generate_json',return_value={'plan':json.dumps(plan)}) as generate:
            result=app.signal_monitor.propose({})
            context=generate.call_args.args[1]
            self.assertEqual((context['offer'],context['pain_points_hypotheses'],context['value_props']),('ERP support','Manual planning','Faster planning'))
        app.signal_monitor.activate({'id':result['id']})
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP implementation','evidence':'Acme announced an ERP implementation.','url':'https://example.com/news'})
        with patch('ai_service.generate_json',return_value={'companies':'[]'}) as generate:
            app.signal_monitor.companies({'id':signal_id})
            offer=generate.call_args.args[1]['offers'][0]
            self.assertEqual((offer['offer'],offer['pain_points'],offer['value_props']),('ERP support','Manual planning','Faster planning'))
        signal=next(s for s in app.signal_engine.state()['items'] if s['id']==signal_id)
        self.assertIsNotNone(signal['companies_checked_at'])
        self.assertEqual(signal['companies_project_revision'],shared_project.get(app.db)['revision'])
        resolved=shared_project.resolve(app.db,{'company_limit':3})
        self.assertEqual((resolved['offer'],resolved['pain_points']),('ERP support','Manual planning'))
