import unittest
from unittest.mock import patch

import app
import languages
import test_app


class DataSimulationTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_mode_preserves_user_records_and_language_preferences(self):
        with app.db() as c:
            before=[tuple(r) for r in c.execute('SELECT * FROM contacts')]
        self.assertIsNone(languages.data_simulation(app.db))
        for enabled in (True,False,True):
            self.assertEqual(languages.save_data_simulation(app.db,{'enabled':enabled}),{'enabled':enabled})
            self.assertEqual(languages.data_simulation(app.db),enabled)
            with app.db() as c:self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM contacts')],before)
            self.assertEqual(languages.preferences(app.db),{'ui_language':'pl','message_language':'pl'})

    def test_invalid_mode_does_not_change_setting(self):
        languages.save_data_simulation(app.db,{'enabled':True})
        for value in ('false',0,None,[]):
            with self.assertRaises(ValueError):languages.save_data_simulation(app.db,{'enabled':value})
        self.assertTrue(languages.data_simulation(app.db))

    def test_snapshot_isolated_and_fresh_on_reenable(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
        with app.simulation_database.request() as real:
            self.assertIsNone(real)
            self.assertEqual(app.workspace_csrf(), app.CSRF)
            app.simulation_database.set({'enabled':True})
        with app.simulation_database.request() as first:
            first_token = app.workspace_csrf()
            self.assertNotEqual(first_token, app.CSRF)
            with app.db() as c:
                self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0], 'paused')
                self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)
                c.execute("UPDATE contacts SET name='Change in simulation'")
            app.simulation_database.set({'enabled':False})
            # An in-flight simulated request keeps its database after the toggle.
            with app.db() as c:
                self.assertEqual(c.execute('SELECT name FROM contacts').fetchone()[0], 'Change in simulation')
        with app.simulation_database.request():
            with app.db() as c:
                self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0], 'active')
                self.assertEqual(c.execute('SELECT name FROM contacts').fetchone()[0], 'Anna')
                c.execute("UPDATE contacts SET name='Latest real name'")
            app.simulation_database.set({'enabled':True})
        with app.simulation_database.request() as second:
            self.assertNotEqual(first, second)
            self.assertNotEqual(first_token, app.workspace_csrf())
            with app.db() as c:
                self.assertEqual(c.execute('SELECT name FROM contacts').fetchone()[0], 'Latest real name')
