import json
import unittest
from unittest.mock import patch

import app
import discovery_pilot
import test_app


class DiscoveryPilotTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def seed(self):
        pipeline = app.discovery_pipeline
        pilot_id = pipeline.command('create', {})['id']
        data = {'pilot_id': pilot_id, 'filename': 'firms.csv',
                'csv': 'company,domain,country\nAcme,example.com,DE\nACME,www.example.com,DE'}
        self.assertEqual(pipeline.command('import', data), {'added': 1, 'reused': 1, 'invalid': 0})
        return pipeline, pilot_id

    def test_task_is_deduplicated_and_stale_lease_cannot_complete(self):
        pipeline, pilot_id = self.seed()
        task = pipeline.task('claim', {'pilot_id': pilot_id})['task']
        key = {'pilot_id': pilot_id, 'task_id': task['id'], 'lease': task['lease']}
        self.assertIsNone(pipeline.task('claim', {'pilot_id': pilot_id})['task'])
        pipeline.task('complete', {**key, 'status': 'needs_intervention', 'checkpoint': task['url']})
        pipeline.task('resume', key)
        new_task = pipeline.task('claim', {'pilot_id': pilot_id})['task']
        self.assertNotEqual(new_task['lease'], task['lease'])
        with self.assertRaisesRegex(ValueError, 'przydzielenie'):
            pipeline.task('complete', {**key, 'status': 'failed'})

    def test_read_checks_claim_and_source_then_passes_public_html_to_browser(self):
        pipeline, pilot_id = self.seed()
        task = pipeline.task('claim', {'pilot_id': pilot_id})['task']
        key = {'pilot_id': pilot_id, 'task_id': task['id'], 'lease': task['lease']}
        with self.assertRaisesRegex(ValueError, 'adres firmy'):
            pipeline.read_page({**key, 'url': 'https://other.example/'})
        with (
            patch('public_data.fetch_public', return_value=('<h1>Acme</h1>', task['url'])) as fetch,
            patch.object(pipeline, 'parse_page', return_value={'url': task['url']}) as parse,
        ):
            self.assertEqual(pipeline.read_page({**key, 'url': task['url']}), {'url': task['url']})
        fetch.assert_called_once_with(task['url'])
        parse.assert_called_once_with({'method': 'research', 'args': {'url': task['url'], 'html': '<h1>Acme</h1>'}})

    def test_evidence_approval_and_exact_outreach_revision(self):
        pipeline, pilot_id = self.seed()
        task = pipeline.task('claim', {'pilot_id': pilot_id})['task']
        key = {'pilot_id': pilot_id, 'task_id': task['id'], 'lease': task['lease']}
        content = 'Maschinenbau GmbH produces hydraulic machines in Germany and maintains integrations with ERP.'
        pipeline.task('complete', {**key, 'status': 'done', 'pages': [{'url': task['url'], 'text': content}]})
        companies = pipeline.state(pilot_id)['companies']
        source = next(row for row in companies[0]['sources'] if row['kind'] == 'browser')
        signals = {
            'market': {'status': 'confirmed', 'country': 'DE', 'evidence': [
                {'source_id': source['id'], 'quote': 'hydraulic machines in Germany'}]},
            'industry': {'status': 'confirmed', 'evidence': [
                {'source_id': source['id'], 'quote': 'produces hydraulic machines'}]},
            'need': {'status': 'confirmed', 'evidence': [
                {'source_id': source['id'], 'quote': 'AI fabricated a new modernization project'}]},
        }
        with (
            patch('ai_service.ready', return_value=True),
            patch('ai_service.model_name', return_value='test-model'),
            patch('ai_service.generate_json', return_value={'findings': json.dumps(signals)}) as ai,
        ):
            qualification = pipeline.qualify(pilot_id, task['company_id'])
            self.assertEqual(pipeline.qualify(pilot_id, task['company_id']), qualification)
        ai.assert_called_once()
        company = pipeline.state(pilot_id)['companies'][0]
        self.assertEqual(company['outcome']['points'], 15)
        self.assertIn('need', company['outcome']['missing'])
        review_key = {'pilot_id': pilot_id, 'company_id': company['id']}
        item = {**review_key, 'contact_id': 1, 'subject': 'Anfrage', 'body': 'Guten Tag'}
        with self.assertRaisesRegex(ValueError, 'zatwierdź firmę'):
            pipeline.handoff(item)
        pipeline.review('review', {**review_key, 'decision': 'approved', 'reason': 'Zweryfikowano ręcznie',
                                   'qualification_id': qualification['id']})
        draft = pipeline.handoff(item)
        self.assertEqual(pipeline.handoff(item), draft)
        message = pipeline.state(pilot_id)['handoffs'][0]
        ids = (draft['campaign_id'], message['message_id'])
        with app.db() as connection:
            self.assertFalse(discovery_pilot.message_allowed(connection, *ids))
        pipeline.approve_message({'pilot_id': pilot_id, 'message_id': message['message_id'], 'fingerprint': message['revision']})
        with app.db() as connection:
            self.assertTrue(discovery_pilot.message_allowed(connection, *ids))
            connection.execute("UPDATE messages SET body='Zmieniona treść' WHERE id=?", (message['message_id'],))
            self.assertFalse(discovery_pilot.message_allowed(connection, *ids))
