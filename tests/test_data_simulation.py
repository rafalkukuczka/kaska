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

    def test_background_scan_skips_providers_without_changing_configuration(self):
        app.signal_monitor.topic({'topic':'ERP'})
        sources=app.signal_engine.state()['sources']
        languages.save_data_simulation(app.db,{'enabled':True})
        with patch('data_connectors.load') as load,patch('sales_signals.fetch_public') as fetch:
            result=app.signal_engine.scan(force=True)
            load.assert_not_called();fetch.assert_not_called()
        self.assertTrue(result['simulated'])
        self.assertEqual(result['created'],0)
        self.assertEqual(app.signal_engine.state()['sources'],sources)
        self.assertEqual(app.signal_engine.state()['items'],[])
