import json
import sqlite3
import unittest
import project_migration


class ProjectMigrationTests(unittest.TestCase):
    def test_legacy_tables_columns_json_selection_and_foreign_keys_are_preserved(self):
        c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=ON')
        c.executescript('''
          CREATE TABLE seller_profiles(id INTEGER PRIMARY KEY,name TEXT,data TEXT,deleted INTEGER DEFAULT 0);
          CREATE TABLE seller_profile_selection(id INTEGER PRIMARY KEY,profile_id INTEGER REFERENCES seller_profiles(id));
          CREATE TABLE content_profiles(id INTEGER PRIMARY KEY,name TEXT);
          CREATE TABLE prospect_runs(id INTEGER PRIMARY KEY,profile_id INTEGER REFERENCES seller_profiles(id),context TEXT);
          CREATE TABLE sales_signals(id INTEGER PRIMARY KEY,companies_profile_revision INTEGER);
          CREATE INDEX runs_profile ON prospect_runs(profile_id);
          INSERT INTO seller_profiles(id,name,data) VALUES(7,'Profil 7','{"offer":"User profile wording stays untouched"}');
          INSERT INTO seller_profiles(id,name,data) VALUES(8,'My Company','{}');
          INSERT INTO seller_profile_selection VALUES(1,7);
          INSERT INTO content_profiles VALUES(12,'Company material');
          INSERT INTO prospect_runs VALUES(3,7,'{"profile_id":7,"nested":{"libraryProfiles":[1]}}');
          INSERT INTO sales_signals VALUES(1,4);
        ''')
        project_migration.migrate(c)
        self.assertEqual(c.execute('SELECT project_id FROM seller_project_selection').fetchone()[0],7)
        self.assertEqual(c.execute('SELECT name FROM seller_projects WHERE id=7').fetchone()[0],'Projekt 7')
        self.assertEqual(c.execute('SELECT name FROM seller_projects WHERE id=8').fetchone()[0],'My Company')
        self.assertEqual(json.loads(c.execute('SELECT data FROM seller_projects WHERE id=7').fetchone()[0])['offer'],'User profile wording stays untouched')
        self.assertEqual(json.loads(c.execute('SELECT context FROM prospect_runs').fetchone()[0]),{'project_id':7,'nested':{'libraryProjects':[1]}})
        self.assertEqual(c.execute('SELECT companies_project_revision FROM sales_signals').fetchone()[0],4)
        self.assertEqual(c.execute('SELECT name FROM content_projects').fetchone()[0],'Company material')
        self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(c.execute('PRAGMA foreign_key_list(prospect_runs)').fetchone()[2],'seller_projects')
        self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name LIKE '%profile%'").fetchall(),[])
        project_migration.migrate(c)
        self.assertEqual(c.execute('SELECT COUNT(*) FROM seller_projects').fetchone()[0],2)

    def test_collision_rolls_back_schema_changes(self):
        c=sqlite3.connect(':memory:')
        c.executescript('CREATE TABLE seller_profiles(id INTEGER PRIMARY KEY); CREATE TABLE seller_projects(id INTEGER PRIMARY KEY);')
        with self.assertRaises(ValueError):project_migration.migrate(c)
        self.assertIsNotNone(c.execute("SELECT 1 FROM sqlite_master WHERE name='seller_profiles'").fetchone())
