import json
import unittest
from unittest.mock import patch

import test_app
import app
import shared_profile


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
            c.execute('DELETE FROM seller_profile')
            c.execute("INSERT INTO content_profiles(website,name,offer,updated) VALUES('https://library.example','Library','Library offer',99)")
            c.execute("INSERT INTO prospect_runs(website,offer,audience,pain_points,value_props,created,updated,titles,department,company_limit,per_company,exclusions) VALUES('https://seller.example','Search offer','Retail teams','Manual work','Save time',1,2,'','',3,2,'[]')")
            shared_profile.init_schema(c)
        profile=shared_profile.get(app.db)
        self.assertEqual((profile['offer'],profile['pain_points'],profile['value_props']),('Search offer','Manual work','Save time'))
        shared_profile.save(app.db,{'offer':'Edited'})
        app.init()
        self.assertEqual(shared_profile.get(app.db)['offer'],'Edited')

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
