import json
import unittest
from unittest.mock import patch

import test_app
import app
import shared_profile
import signal_monitoring


class SharedProfileTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_patch_persistence_explicit_clear_and_conflict(self):
        original=shared_profile.get(app.db)
        saved=shared_profile.save(app.db,{'website':'example.com','offer':'Services','pain_points':'Manual work','value_props':'Less work','revision':original['revision']})
        shared_profile.save(app.db,{'offer':'Updated','revision':saved['revision']})
        profile=shared_profile.get(app.db)
        self.assertEqual((profile['pain_points'],profile['value_props']),('Manual work','Less work'))
        with self.assertRaises(ValueError):shared_profile.save(app.db,{'offer':'Stale','revision':saved['revision']})
        self.assertEqual(shared_profile.get(app.db)['offer'],'Updated')
        for item in ({'offer':None},{'pain_points':[]},{'audience':'x'*3001}):
            with self.subTest(item=item),self.assertRaises(ValueError):shared_profile.save(app.db,item)
        shared_profile.save(app.db,{'pain_points':''})
        self.assertEqual(shared_profile.get(app.db)['pain_points'],'')
        app.init()
        self.assertEqual(shared_profile.get(app.db)['offer'],'Updated')

    def test_one_time_migration_prefers_latest_search_to_library(self):
        with app.db() as c:
            c.execute('DELETE FROM seller_profile_selection')
            c.execute('DELETE FROM seller_profiles')
            c.execute('DELETE FROM seller_profile')
            c.execute("INSERT INTO content_profiles(website,name,offer,updated) VALUES('https://library.example','Library','Library offer',99)")
            c.execute("INSERT INTO prospect_runs(website,offer,audience,pain_points,value_props,created,updated,titles,department,company_limit,per_company,exclusions) VALUES('https://seller.example','Search offer','Retail teams','Manual work','Save time',1,2,'','',3,2,'[]')")
            shared_profile.init_schema(c)
        profile=shared_profile.get(app.db)
        self.assertEqual((profile['offer'],profile['pain_points'],profile['value_props']),('Search offer','Manual work','Save time'))
        shared_profile.save(app.db,{'offer':'Edited'})
        app.init()
        self.assertEqual(shared_profile.get(app.db)['offer'],'Edited')

    def test_profiles_switch_and_preserve_independent_data_and_late_saves(self):
        first=shared_profile.save(app.db,{'name':'First','offer':'Consulting','pain_points':'Manual work','value_props':'Save time'})
        second=shared_profile.create(app.db,{'name':'Second'})
        self.assertEqual(second['offer'],'')
        self.assertEqual(second['pain_points'],'')
        shared_profile.save(app.db,{'profile_id':second['id'],'offer':'Delivery'})
        # A queued write for the previous profile must not modify the newly selected one.
        shared_profile.save(app.db,{'profile_id':first['id'],'offer':'Late consulting update','revision':first['revision']})
        self.assertEqual(shared_profile.get(app.db)['offer'],'Delivery')
        shared_profile.select(app.db,{'profile_id':first['id']})
        self.assertEqual(shared_profile.get(app.db)['offer'],'Late consulting update')
        self.assertEqual(shared_profile.get(app.db)['value_props'],'Save time')
        shared_profile.select(app.db,{'profile_id':second['id']})
        app.init()
        self.assertEqual(shared_profile.get(app.db)['id'],second['id'])
        self.assertEqual(len(shared_profile.profiles(app.db)),2)
        for name in ('','x'*101,None):
            with self.subTest(name=name),self.assertRaises(ValueError):shared_profile.create(app.db,{'name':name})
        with self.assertRaises(ValueError):shared_profile.select(app.db,{'profile_id':9999})

    def test_monitoring_and_company_assessments_belong_to_profile_even_after_switch(self):
        first=shared_profile.save(app.db,{'offer':'First offer'})
        app.signal_monitor.topic({'topic':'ERP'})
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP','evidence':'Acme ERP project.','url':'https://example.com/erp'})
        second=shared_profile.create(app.db,{'name':'Second'})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        rows=[{'company':'Acme','quote':'Acme ERP project.','reason':'Potential ERP project.'}]
        with patch('ai_service.generate_json',return_value={'companies':json.dumps(rows)}):
            app.signal_monitor.companies({'id':signal_id,'profile_id':first['id']})
        self.assertEqual(app.signal_monitor.state()['companies'],[])
        shared_profile.select(app.db,{'profile_id':first['id']})
        self.assertEqual(len(app.signal_monitor.state()['companies']),1)
        self.assertEqual(app.signal_monitor.state()['reviews'][0]['revision'],first['revision'])
        # The same event can have a separate assessment with a different profile's offer.
        with patch('ai_service.generate_json',return_value={'companies':json.dumps([{**rows[0],'reason':'Different offer context.'}])}):
            app.signal_monitor.companies({'id':signal_id,'profile_id':second['id']})
        self.assertEqual(app.signal_monitor.state()['companies'][0]['reason'],'Potential ERP project.')
        self.assertEqual(app.signal_monitor.state(second['id'])['companies'][0]['reason'],'Different offer context.')

    def test_offer_plan_created_after_switch_stays_with_originating_profile(self):
        first=shared_profile.save(app.db,{'offer':'First offer'})
        second=shared_profile.create(app.db,{'name':'Second'})
        def generate(*args,**kwargs):
            shared_profile.select(app.db,{'profile_id':second['id']})
            return {'plan':json.dumps([{'topic':'ERP','signal_kinds':['erp'],'reason':'ERP work'}])}
        with patch('ai_service.generate_json',side_effect=generate):
            plan=app.signal_monitor.propose({'profile_id':first['id']})
        with self.assertRaises(ValueError):app.signal_monitor.activate({'id':plan['id']})
        app.signal_monitor.activate({'id':plan['id'],'profile_id':first['id']})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        self.assertEqual(len(app.signal_monitor.state(first['id'])['monitors']),1)

    def test_legacy_company_migration_preserves_data_without_recreating_cleared_results(self):
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP','evidence':'Acme ERP project.','url':'https://example.com/erp'})
        with app.db() as c:
            c.execute('DROP TABLE signal_profile_companies')
            c.execute('DROP TABLE signal_company_reviews')
            c.execute("INSERT INTO signal_companies(signal_id,company,reason,quote) VALUES(?,'Acme','Legacy reason','Acme ERP project.')",(signal_id,))
            c.execute('UPDATE sales_signals SET companies_checked_at=123,companies_profile_revision=0 WHERE id=?',(signal_id,))
            signal_monitoring.init_schema(c)
        state=app.signal_monitor.state()
        self.assertEqual(state['companies'][0]['reason'],'Legacy reason')
        self.assertEqual(state['reviews'][0]['checked_at'],123)
        with patch('ai_service.generate_json',return_value={'companies':'[]'}):app.signal_monitor.companies({'id':signal_id})
        app.init()
        self.assertEqual(app.signal_monitor.state()['companies'],[])

    def test_customer_search_history_is_separate_per_profile(self):
        first=shared_profile.get(app.db)
        second=shared_profile.create(app.db,{'name':'Second'})
        with app.db() as c:
            for profile in (first,second):
                c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,profile_id) VALUES('https://example.com','Offer','Audience','','',1,1,'[]',1,2,?)",(profile['id'],))
        self.assertEqual([r['profile_id'] for r in app.prospector.state()['runs']],[second['id']])
        shared_profile.select(app.db,{'profile_id':first['id']})
        self.assertEqual([r['profile_id'] for r in app.prospector.state()['runs']],[first['id']])

    def test_shared_context_used_by_offer_plan_and_company_assessment(self):
        shared_profile.save(app.db,{'offer':'ERP support','audience':'Manufacturers','pain_points':'Manual planning','value_props':'Faster planning'})
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
        self.assertEqual(signal['companies_profile_revision'],shared_profile.get(app.db)['revision'])
        resolved=shared_profile.resolve(app.db,{'company_limit':3})
        self.assertEqual((resolved['offer'],resolved['pain_points']),('ERP support','Manual planning'))
