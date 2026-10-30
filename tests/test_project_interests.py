import json
import unittest
from unittest.mock import patch

import app
import feature_retirement
import opportunity_catalog
import shared_project
import test_app
import public_data


class ProjectInterestsTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_catalog_preferences_are_saved_per_project_and_not_used_in_search(self):
        before=shared_project.get(app.db)
        with patch('ai_service.generate_json') as ai:
            saved=shared_project.save(app.db,{'signal_interests':['funding','new_factory','funding']})
            ai.assert_not_called()
        self.assertEqual(saved['signal_interests'],['funding','new_factory'])
        self.assertTrue(all(saved[key]==before[key] for key in shared_project.FIELDS))
        self.assertNotIn('signal_interests',shared_project.resolve(app.db,{}))
        other=shared_project.create(app.db,{'name':'Other'})
        self.assertEqual(other['signal_interests'],[])
        shared_project.save(app.db,{'signal_interests':['erp']})
        shared_project.select(app.db,{'project_id':before['id']})
        self.assertEqual(shared_project.get(app.db)['signal_interests'],['funding','new_factory'])
        app.init()
        self.assertEqual(shared_project.get(app.db)['signal_interests'],['funding','new_factory'])
        self.assertEqual(shared_project.save(app.db,{'signal_interests':[]})['signal_interests'],[])

    def test_invalid_preferences_are_rejected_without_writing(self):
        before=shared_project.get(app.db)
        for value in ('funding',['unknown'],[None],[1],{},['funding']*100):
            with self.subTest(value=value),self.assertRaises(ValueError):shared_project.save(app.db,{'signal_interests':value})
        self.assertEqual(shared_project.get(app.db),before)
        self.assertGreaterEqual(len(opportunity_catalog.CATALOG),50)
        self.assertEqual(len({row['key'] for row in opportunity_catalog.CATALOG}),len(opportunity_catalog.CATALOG))
        self.assertTrue(all(set(row)=={'key','label','category'} for row in opportunity_catalog.CATALOG))

    def test_fresh_install_has_no_monitoring_tables_or_services(self):
        with app.db() as c:
            tables={row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertFalse(tables&{'sales_signals','signal_rules','signal_sources','signal_monitors','signal_analyses','source_discovery_jobs'})
        self.assertFalse(any(hasattr(app,name) for name in ['signal_engine','signal_monitor','signal_analyzer','source_finder']))

    def test_retirement_freezes_old_automation_and_preserves_only_enrolled_recipients(self):
        app.prepare(1)
        with app.db() as c:
            app.add_contact(c,{'email':'unrelated@example.com','company':'Other'})
            c.executescript('''
              CREATE TABLE signal_rules(campaign_id INTEGER PRIMARY KEY,enabled INTEGER DEFAULT 1);
              INSERT INTO signal_rules(campaign_id) VALUES(1);
              CREATE TABLE signal_sources(id INTEGER PRIMARY KEY,enabled INTEGER);INSERT INTO signal_sources VALUES(1,1);
              CREATE TABLE signal_analysis_settings(project_id INTEGER PRIMARY KEY,enabled INTEGER);INSERT INTO signal_analysis_settings VALUES(1,1);
              CREATE TABLE signal_analyses(status TEXT,stage TEXT);INSERT INTO signal_analyses VALUES('running','Processing');
              CREATE TABLE source_discovery_jobs(status TEXT,stage TEXT);INSERT INTO source_discovery_jobs VALUES('running','Processing');
              DELETE FROM feature_retirements;
            ''')
            c.execute("UPDATE campaigns SET audience_mode='signals' WHERE id=1")
            c.execute("INSERT INTO campaigns(id,name,offer,audience,audience_mode,created) VALUES(2,'Empty','Offer','Audience','signals',1)")
            before=[dict(r) for r in c.execute('SELECT * FROM messages')]
            feature_retirement.retire_monitoring(c)
            campaign=dict(c.execute('SELECT * FROM campaigns WHERE id=1').fetchone())
            self.assertEqual(campaign['audience_mode'],'selected')
            self.assertEqual(json.loads(campaign['contact_ids']),[1])
            self.assertEqual(c.execute('SELECT contact_ids FROM campaigns WHERE id=2').fetchone()[0],'[]')
            self.assertEqual([dict(r) for r in c.execute('SELECT * FROM messages')],before)
            self.assertEqual(c.execute('SELECT enabled FROM signal_rules').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT enabled FROM signal_sources').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT enabled FROM signal_analysis_settings').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT status FROM signal_analyses').fetchone()[0],'interrupted')
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags='[\"VIP\"]' WHERE id=1")
            feature_retirement.retire_monitoring(c)
            self.assertEqual(c.execute('SELECT audience_mode FROM campaigns WHERE id=1').fetchone()[0],'tags')
        with self.assertRaises(ValueError):app.prepare(2)

    def test_shared_public_fetch_still_blocks_private_addresses(self):
        with patch('public_data.socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):public_data.fetch_public('https://example.com')
