import json
import unittest
from unittest.mock import patch
import app
import shared_project
import test_app


class SharedMonitoringTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def create(self,name,shared=True,contacts=False):
        return shared_project.create(app.db,{'name':name,'share_monitorings':shared,'share_contacts':contacts})['id']

    def test_shared_monitors_use_the_same_records_and_private_projects_stay_separate(self):
        first=self.create('Shared A')
        monitor=app.signal_monitor.topic({'topic':'Shared ERP'})
        second=self.create('Shared B')
        state=app.signal_monitor.state()
        self.assertEqual([m['id'] for m in state['monitors']],[monitor['id']])
        self.assertTrue(state['monitors'][0]['shared'])
        self.assertFalse(shared_project.get(app.db)['share_contacts'])
        app.signal_monitor.topic({'topic':'Shared funding'})
        self.assertEqual(len(app.signal_monitor.state(first)['monitors']),2)
        private=self.create('Private',False,True)
        self.assertEqual(app.signal_monitor.state()['monitors'],[])
        app.signal_monitor.topic({'topic':'Private hiring'})
        self.assertEqual(len(app.signal_monitor.state()['monitors']),1)
        self.assertFalse(app.signal_monitor.state()['monitors'][0]['shared'])
        self.assertEqual(len(app.signal_monitor.state(second)['monitors']),2)
        with self.assertRaises(ValueError):app.signal_monitor.delete({'id':monitor['id'],'project_id':private})
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM signal_monitors').fetchone()[0],3)
        app.init()
        self.assertEqual(len(app.signal_monitor.state(first)['monitors']),2)

    def test_shared_offer_plan_can_be_activated_and_deleted_by_another_member(self):
        first=self.create('Offer A')
        shared_project.save(app.db,{'offer':'Services'})
        with patch('ai_service.generate_json',return_value={'plan':json.dumps([{'topic':'ERP','signal_kinds':['erp'],'reason':'ERP services'}])}):
            draft=app.signal_monitor.propose({})
        second=self.create('Offer B')
        app.signal_monitor.activate({'id':draft['id']})
        monitor=app.signal_monitor.state(first)['monitors'][0]
        self.assertEqual(monitor['mode'],'offer')
        self.assertEqual(monitor['id'],draft['id'])
        self.assertEqual(app.signal_monitor.state(second)['other_source_ids'],[])
        # A private monitor sharing the same physical feed must continue running.
        app.signal_monitor.topic({'topic':'ERP','signal_kinds':['erp'],'project_id':1})
        self.assertTrue(app.signal_monitor.state(second)['other_source_ids'])
        app.signal_monitor.delete({'id':draft['id']})
        self.assertEqual(app.signal_monitor.state(first)['monitors'],[])
        self.assertEqual(app.signal_monitor.state(second)['monitors'],[])
        with app.db() as c:
            for source_id in monitor['source_ids']:self.assertEqual(c.execute('SELECT enabled FROM signal_sources WHERE id=?',(source_id,)).fetchone()[0],1)

    def test_deleting_creator_preserves_monitors_until_last_sharing_project_is_deleted(self):
        first=self.create('Creator')
        monitor=app.signal_monitor.topic({'topic':'Unique shared topic'})
        source_ids=app.signal_monitor.state()['monitors'][0]['source_ids']
        second=self.create('Survivor')
        shared_project.delete(app.db,{'project_id':first})
        self.assertEqual(app.signal_monitor.state(second)['monitors'][0]['id'],monitor['id'])
        with app.db() as c:
            self.assertEqual(c.execute('SELECT project_id FROM signal_monitors WHERE id=?',(monitor['id'],)).fetchone()[0],second)
            self.assertTrue(all(c.execute('SELECT enabled FROM signal_sources WHERE id=?',(sid,)).fetchone()[0] for sid in source_ids))
        shared_project.delete(app.db,{'project_id':second})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM signal_monitors WHERE id=?',(monitor['id'],)).fetchone()[0],'deleted')
            self.assertTrue(all(not c.execute('SELECT enabled FROM signal_sources WHERE id=?',(sid,)).fetchone()[0] for sid in source_ids))

    def test_option_is_explicit_and_independent_of_contact_sharing(self):
        self.assertFalse(shared_project.get(app.db)['share_monitorings'])
        private=shared_project.create(app.db,{'name':'Private by default','share_contacts':True})
        self.assertFalse(private['share_monitorings']);self.assertTrue(private['share_contacts'])
        for value in ('true',1,None,[]):
            with self.subTest(value=value),self.assertRaises(ValueError):shared_project.create(app.db,{'name':'Invalid','share_monitorings':value})


if __name__=='__main__':unittest.main()
