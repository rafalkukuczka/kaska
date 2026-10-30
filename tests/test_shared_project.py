import json
import unittest
from unittest.mock import patch

import test_app
import app
import shared_project


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


    def test_delete_rejects_busy_search_and_late_ai_cannot_restore_deleted_project(self):
        project=shared_project.get(app.db)
        with app.db() as c:
            run_id=c.execute("INSERT INTO prospect_runs(website,offer,audience,titles,department,company_limit,per_company,exclusions,created,updated,project_id) VALUES('https://example.com','Offer','Audience','','',1,1,'[]',1,2,?)",(project['id'],)).lastrowid
        with self.assertRaises(ValueError):shared_project.delete(app.db,{'project_id':project['id']})
        self.assertEqual(shared_project.get(app.db)['id'],project['id'])
        with app.db() as c:c.execute("UPDATE prospect_runs SET status='completed' WHERE id=?",(run_id,))
