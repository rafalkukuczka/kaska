import json
import unittest
from unittest.mock import patch

import test_app
import app


class MonitoringTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def proposal(self,rows=None):
        rows=rows if rows is not None else [{'topic':'NIS2','signal_kinds':['regulation'],'reason':'Compliance creates a reason to review security services.'}]
        with patch('ai_service.generate_json',return_value={'plan':json.dumps(rows)}) as generate:
            result=app.signal_monitor.propose({'offer':'Security consulting','audience':'IT teams'})
            self.assertFalse(generate.call_args.kwargs.get('web_search',False))
            return result

    def test_offer_plan_needs_no_contacts_and_waits_for_activation(self):
        with app.db() as c:c.execute('DELETE FROM contacts')
        result=self.proposal()
        self.assertEqual(app.signal_engine.state()['sources'],[])
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        activated=app.signal_monitor.activate({'id':result['id'],'selected':[0]})
        self.assertEqual(activated['created'],2)
        sources=app.signal_engine.state()['sources']
        self.assertTrue(all(s['company']=='' and not s['auto_accept'] for s in sources))
        self.assertEqual({s['kind'] for s in sources},{'google_news','gdelt'})
        self.assertTrue(all(json.loads(s['signal_kinds'])==['regulation'] for s in sources))
        monitor=app.signal_monitor.state()['monitors'][0]
        self.assertEqual(monitor['mode'],'offer')
        self.assertEqual(monitor['offer'],'Security consulting')
        self.assertEqual(len(monitor['source_ids']),2)
        self.assertEqual(app.signal_monitor.activate({'id':result['id']})['created'],0)

    def test_topic_needs_neither_ai_offer_nor_contacts(self):
        with app.db() as c:c.execute('DELETE FROM contacts')
        with patch('ai_service.generate_json') as generate:
            result=app.signal_monitor.topic({'topic':'NIS2'})
            generate.assert_not_called()
        self.assertEqual(result['created'],2)
        monitor=app.signal_monitor.state()['monitors'][0]
        self.assertEqual((monitor['mode'],monitor['offer']),('topic',''))
        self.assertEqual(monitor['plan'][0]['signal_kinds'],[])

    def test_monitoring_areas_are_validated_and_independent_of_project(self):
        import shared_project
        area={'lat':52.2,'lng':21,'radius_km':50,'label':'Warsaw'}
        shared_project.save(app.db,{'search_areas':[area]})
        inherited=app.signal_monitor.topic({'topic':'ERP'})
        explicit=app.signal_monitor.topic({'topic':'Automation','search_areas':[]})
        shared_project.save(app.db,{'search_areas':[]})
        monitors={m['id']:m for m in app.signal_monitor.state()['monitors']}
        self.assertEqual(monitors[inherited['id']]['search_areas'],[area])
        self.assertEqual(monitors[explicit['id']]['search_areas'],[])
        with self.assertRaises(ValueError):app.signal_monitor.topic({'topic':'Invalid','search_areas':[dict(area,radius_km=-1)]})
        self.assertEqual(len(app.signal_monitor.state()['monitors']),2)

    def test_offer_areas_reach_ai_and_can_be_changed_before_activation(self):
        first={'lat':52.2,'lng':21,'radius_km':50,'label':'Warsaw'}
        second={'lat':48.85,'lng':2.35,'radius_km':25,'label':'Paris'}
        with patch('ai_service.generate_json',return_value={'plan':json.dumps([{'topic':'ERP','signal_kinds':[],'reason':'Context'}])}) as generate:
            draft=app.signal_monitor.propose({'offer':'Services','search_areas':[first]})
        self.assertEqual(generate.call_args.args[1]['search_areas'],[first])
        self.assertEqual(draft['search_areas'],[first])
        with self.assertRaises(ValueError):app.signal_monitor.activate({'id':draft['id'],'search_areas':[dict(first,lat=100)]})
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        app.signal_monitor.activate({'id':draft['id'],'search_areas':[second]})
        self.assertEqual(app.signal_monitor.state()['monitors'][0]['search_areas'],[second])

    def test_delete_pauses_exclusive_sources_and_preserves_events(self):
        monitor=app.signal_monitor.topic({'topic':'ERP'})
        source=app.signal_engine.state()['sources'][0]
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp',
            'title':'Acme ERP project','evidence':'Acme announced ERP.','url':'https://example.com/erp'},source=source)
        self.assertEqual(app.signal_monitor.post('delete',{'id':monitor['id']})['paused'],2)
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        self.assertTrue(all(not s['enabled'] for s in app.signal_engine.state()['sources']))
        with app.db() as c:
            self.assertIsNotNone(c.execute('SELECT id FROM sales_signals WHERE id=?',(signal_id,)).fetchone())
        self.assertEqual(app.signal_monitor.delete({'id':monitor['id']})['paused'],0)
        with self.assertRaises(ValueError):app.signal_monitor.activate({'id':monitor['id']})

    def test_delete_keeps_shared_sources_and_checks_project_ownership(self):
        first=app.signal_monitor.topic({'topic':'ERP'})
        import shared_project
        other=shared_project.create(app.db,{'name':'Other'})
        second=app.signal_monitor.topic({'topic':'ERP','project_id':other['id']})
        with self.assertRaises(ValueError):
            app.signal_monitor.delete({'id':first['id'],'project_id':other['id']})
        self.assertEqual(app.signal_monitor.delete({'id':first['id'],'project_id':1})['paused'],0)
        self.assertTrue(all(s['enabled'] for s in app.signal_engine.state()['sources']))
        self.assertEqual(len(app.signal_monitor.state(other['id'])['monitors']),1)
        self.assertEqual(app.signal_monitor.delete({'id':second['id'],'project_id':other['id']})['paused'],2)

    def test_plan_selection_and_invalid_input_are_atomic(self):
        result=self.proposal([{'topic':term,'signal_kinds':[],'reason':'Context'} for term in ('NIS2','ERP')])
        for selection in ([],[-1],[99],[True],['0']):
            with self.subTest(selection=selection),self.assertRaises(ValueError):app.signal_monitor.activate({'id':result['id'],'selected':selection})
        self.assertEqual(app.signal_engine.state()['sources'],[])
        app.signal_monitor.activate({'id':result['id'],'selected':[1,1]})
        self.assertEqual(len(app.signal_engine.state()['sources']),2)
        self.assertEqual(app.signal_monitor.state()['monitors'][0]['plan'][0]['topic'],'ERP')
        for row in ({'topic':'"NIS2"'},{'topic':'a'},{'topic':'ERP','signal_kinds':['invalid']}):
            with self.subTest(row=row),self.assertRaises(ValueError):app.signal_monitor.topic(row)
        with self.assertRaises(ValueError):app.signal_monitor.propose({'offer':''})
        with self.assertRaises(ValueError):self.proposal([])

    def test_shared_sources_expand_filters_and_keep_acceptance_and_pause(self):
        result=self.proposal();app.signal_monitor.activate({'id':result['id']})
        with app.db() as c:c.execute('UPDATE signal_sources SET auto_accept=1,enabled=0')
        app.signal_monitor.topic({'topic':'NIS2','signal_kinds':['tender']})
        sources=app.signal_engine.state()['sources']
        self.assertEqual(len(sources),2)
        self.assertTrue(all(set(json.loads(s['signal_kinds']))=={'regulation','tender'} for s in sources))
        self.assertTrue(all(s['auto_accept'] and not s['enabled'] for s in sources))
        app.signal_monitor.topic({'topic':'NIS2'})
        self.assertTrue(all(json.loads(s['signal_kinds'])==[] for s in app.signal_engine.state()['sources']))

    def test_company_extraction_requires_literal_evidence_and_does_not_create_contacts(self):
        app.signal_monitor.topic({'topic':'ERP'})
        source=app.signal_engine.state()['sources'][0]
        signal_id=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP implementation',
            'evidence':'Acme announced an ERP implementation.','url':'https://example.com/news'},source=source)
        row={'company':'Acme','quote':'Acme announced an ERP implementation.','reason':'Review the project before outreach.'}
        with patch('ai_service.generate_json',return_value={'companies':json.dumps([row])}):
            self.assertEqual(app.signal_monitor.companies({'id':signal_id})['count'],1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
        for invalid in ({**row,'company':'Imaginary'},{**row,'quote':'Invented text'}):
            with patch('ai_service.generate_json',return_value={'companies':json.dumps([invalid])}),self.assertRaises(ValueError):
                app.signal_monitor.companies({'id':signal_id})
        self.assertEqual(len(app.signal_monitor.state()['companies']),1)
        with patch('ai_service.generate_json',return_value={'companies':'[]'}):
            self.assertEqual(app.signal_monitor.companies({'id':signal_id})['count'],0)
        self.assertEqual(app.signal_monitor.state()['companies'],[])

    def test_company_relevance_uses_only_matching_offer_plans(self):
        result=self.proposal();app.signal_monitor.activate({'id':result['id']})
        with patch('ai_service.generate_json',return_value={'plan':json.dumps([{'topic':'NIS2','signal_kinds':['erp'],'reason':'ERP projects'}])}):
            other=app.signal_monitor.propose({'offer':'Unrelated ERP offer'})
        app.signal_monitor.activate({'id':other['id']})
        source=app.signal_engine.state()['sources'][0]
        signal_id=app.signal_engine.record({'scope':'market','topic':'NIS2','kind':'regulation','title':'Acme NIS2',
            'evidence':'Acme announced a NIS2 project.','url':'https://example.com/nis2'},source=source)
        with patch('ai_service.generate_json',return_value={'companies':'[]'}) as generate:
            app.signal_monitor.companies({'id':signal_id})
            self.assertEqual(generate.call_args.args[1]['offers'],[{'offer':'Security consulting','audience':'IT teams'}])
