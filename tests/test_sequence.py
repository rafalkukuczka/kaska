import json
import unittest
from unittest.mock import patch

import test_app
import app
import sequence_conditions as conditions


class SequenceTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_conditions_filter_preparation_and_sending(self):
        rule = [{'field': 'role', 'operator': 'contains', 'value': 'CEO'}]
        with app.db() as c:
            c.execute('UPDATE campaigns SET conditions=? WHERE id=1', (json.dumps(rule),))
            c.execute("UPDATE contacts SET role='CEO' WHERE id=1")
            app.add_contact(c, {'email': 'other@example.com', 'role': 'Intern'})
        app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE contacts SET role='Intern' WHERE id=1")
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.assert_not_called()
        with app.db() as c:
            c.execute("UPDATE contacts SET role='CEO' WHERE id=1")
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.return_value.__enter__.return_value.send_message.assert_called_once()

    def test_invalid_and_compound_conditions(self):
        rules = conditions.validate([{'field': 'email', 'operator': 'is_set'}, {'field': 'company', 'operator': 'equals', 'value': ' ACME '}])
        self.assertTrue(conditions.matches(rules, {'email': 'a@example.com', 'company': 'Acme'}))
        self.assertFalse(conditions.matches(rules, {'email': '', 'company': 'Acme'}))
        self.assertFalse(conditions.matches('not-json', {}))
        for value in ([{'field': 'password', 'operator': 'is_set'}], [{'field': 'role', 'operator': 'contains', 'value': ''}], [{}]*11):
            with self.assertRaises(ValueError):
                conditions.validate(value)

    def test_step_ai_is_template_only_and_validates_output(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'subject': 'Hello {{company}}', 'body': 'Hi {{name}}, let us talk.'}) as generate:
            result = app.step_prompt({'mode': 'first_touch', 'offer': 'Shipping services', 'language': 'en', 'note': 'Keep it short'})
            self.assertIn('{{name}}', result['body'])
            self.assertEqual(generate.call_args.args[1]['note'], 'Keep it short')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'subject': 'Hello', 'body': '{{unknown_variable}}'}):
            with self.assertRaises(ValueError):
                app.step_prompt({'mode': 'first_touch', 'offer': 'Shipping services'})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)

    def test_success_stories_excludes_homepage_and_requires_actual_story(self):
        root = {'url': 'https://sender.example/', 'title': 'Sender', 'summary': 'Our services', 'excerpt': 'Our services', 'links': []}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', return_value=root), patch('app.ai_service.generate_json') as generate:
            with self.assertRaisesRegex(ValueError, 'historii sukcesu'):
                app.proof_points_from_website({'website': 'sender.example', 'stories_only': True})
            generate.assert_not_called()
        root['links'] = [('/case-study', 'Success story')]
        case = dict(root, url='https://sender.example/case-study', excerpt='Delivered 120 projects.', summary='Delivered 120 projects.')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', side_effect=[root, case]), patch('app.ai_service.generate_json', return_value={'proof_points': 'https://sender.example/case-study\tDelivered 120 projects.'}) as generate:
            result = app.proof_points_from_website({'website': 'sender.example', 'stories_only': True})
            self.assertNotIn(root['url'], generate.call_args.args[1]['pages'])
            self.assertIn('120 projects', result['proof_points'])
