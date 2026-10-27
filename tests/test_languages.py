import unittest
from unittest.mock import patch

import test_app
import app
import languages


class LanguageTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_preferences_persist_and_remain_independent(self):
        self.assertEqual(languages.preferences(app.db), {'ui_language': 'pl', 'message_language': 'pl'})
        languages.save_preferences(app.db, {'ui_language': 'en', 'message_language': 'de'})
        app.init()
        self.assertEqual(languages.preferences(app.db), {'ui_language': 'en', 'message_language': 'de'})
        languages.save_preferences(app.db, {'ui_language': 'pl'})
        self.assertEqual(languages.preferences(app.db)['message_language'], 'de')
        with app.db() as c:
            self.assertEqual(c.execute('SELECT language FROM campaigns WHERE id=1').fetchone()[0], 'pl')

    def test_invalid_preferences_do_not_partially_save(self):
        for item in ({'ui_language': 'de'}, {'message_language': 'xx'}, {'ui_language': 'en', 'message_language': 'xx'}, {'OPENAI_API_KEY': 'x'}):
            with self.subTest(item=item), self.assertRaises(ValueError):
                languages.save_preferences(app.db, item)
            self.assertEqual(languages.preferences(app.db)['ui_language'], 'pl')

    def test_copy_instructions_materials_cta_and_footer_use_campaign_language(self):
        with app.db() as c:
            contact = dict(c.execute('SELECT * FROM contacts').fetchone())
            base = dict(c.execute('SELECT * FROM campaigns').fetchone())
        material = {'title': 'Original material title', 'url': 'https://sender.example/article', 'summary': 'Original text'}
        for code, spec in languages.LANGUAGES.items():
            with self.subTest(code=code):
                campaign = dict(base, language=code, cta_url='https://sender.example/contact')
                with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.library.select', return_value=material), patch('app.ai_service.generate_json', return_value={'subject': 'Subject', 'body': 'Body'}) as generate:
                    _, body = app.ai_copy(contact, campaign, languages.steps(code)[0])
                    self.assertIn('po '+spec['prompt'], generate.call_args.args[0])
                    self.assertIn(spec['material'], body)
                    self.assertIn(spec['cta'], body)
                with app.db() as c:
                    c.execute('DELETE FROM messages')
                    c.execute("UPDATE campaigns SET language=?,status='active' WHERE id=1", (code,))
                    c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due) VALUES(1,1,0,'Subject','Body',0)")
                with patch('app.smtplib.SMTP') as smtp:
                    app.send_one()
                    sent = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
                    self.assertIn(spec['footer'], sent.get_content())

    def test_campaign_validation_accepts_all_supported_languages(self):
        with app.db() as c:
            for code in languages.LANGUAGES:
                self.assertEqual(app.library.validate_campaign(c, {'language': code})[5], code)
            with self.assertRaises(ValueError):
                app.library.validate_campaign(c, {'language': 'unknown'})
