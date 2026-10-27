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
