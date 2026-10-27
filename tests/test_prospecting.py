import io
import json
import os
import time
import threading
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, Mock
from urllib.parse import parse_qs, urlparse

import test_app
import app
import prospecting
import languages


class ProspectingTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def setup_run(self, **overrides):
        self.manager = prospecting.Prospecting(app.db, app.library, app.ai_copy, app.MAIL_LOCK)
        item = dict(website='https://seller.example/', offer='Usługi logistyczne dla sklepów.', audience='Retail companies in Poland', company_limit=3, per_company=2, department='operations')
        item.update(overrides)
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.threading.Thread'):
            result = self.manager.start(item)
        self.manager.lock.release()
        return result['id']

    def provider(self, endpoint, params=None, body=None):
        if endpoint == 'discover':
            return {'data': [{'domain': 'buyer.example', 'organization': 'Buyer'}], 'meta': {'filters': {'country': 'PL'}}}
        if endpoint == 'domain-search':
            return {'data': {'emails': [dict(value='anna@buyer.example', first_name='Anna', last_name='Nowak', position='COO', type='personal', provenance='found', sources=[{'uri': 'https://buyer.example/team', 'last_seen_on': '2026-10-20'}])]}}
        if endpoint == 'email-verifier':
            return {'data': {'status': 'valid', 'accept_all': False, 'verification': {'status': 'valid', 'date': datetime.now(timezone.utc).strftime('%Y-%m-%d')}}}
        return {'data': {}}

    def search(self, run_id):
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', side_effect=self.provider), patch.object(app.library, 'page', return_value={'url': 'https://buyer.example/', 'summary': 'Buyer runs online retail shops.'}):
            self.manager.search(run_id)
        self.manager.update(run_id, status='ready')
        with app.db() as c:
            return dict(c.execute('SELECT * FROM prospect_candidates WHERE run_id=?', (run_id,)).fetchone())

    def verify(self, run_id):
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', side_effect=self.provider):
            self.manager.verify(run_id)

    def test_full_pipeline_creates_review_only_drafts_and_is_idempotent(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.assertEqual(row['qualification'], 'uncertain')
        self.assertIn('https://buyer.example/team', row['sources'])
        self.assertEqual(row['verification_status'], 'unverified')
        self.verify(run_id)
        result = self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        self.assertEqual(self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]}), result)
        with app.db() as c:
            campaign = c.execute('SELECT * FROM campaigns WHERE id=?', (result['campaign_id'],)).fetchone()
            self.assertEqual(campaign['status'], 'draft')
            self.assertEqual(campaign['audience_mode'], 'selected')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages WHERE campaign_id=?', (campaign['id'],)).fetchone()[0], 2)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts WHERE email=?', (row['email'],)).fetchone()[0], 1)

    def test_unverified_unknown_catchall_rejected_and_old_verification_block_drafts(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        for status in ('unverified', 'unknown', 'accept_all', 'pending', 'invalid'):
            with self.subTest(status=status), app.db() as c:
                c.execute('UPDATE prospect_candidates SET verification_status=? WHERE id=?', (status, row['id']))
            with self.assertRaises(ValueError):
                self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        self.verify(run_id)
        with app.db() as c:
            c.execute("UPDATE prospect_candidates SET qualification='rejected' WHERE id=?", (row['id'],))
        with self.assertRaises(ValueError):
            self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        with app.db() as c:
            c.execute("UPDATE prospect_candidates SET qualification='uncertain',checked_at=? WHERE id=?", (time.time()-8*86400, row['id']))
        with self.assertRaises(ValueError):
            self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})

    def test_delete_campaign_unlinks_search_and_preserves_verified_candidates(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        result = self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        app.delete_campaign(result['campaign_id'])
        self.assertIsNone(self.manager.get_run(run_id)['campaign_id'])
        with app.db() as c:
            self.assertEqual(c.execute('SELECT verification_status FROM prospect_candidates WHERE id=?', (row['id'],)).fetchone()[0], 'valid')
            self.assertIsNotNone(c.execute('SELECT id FROM contacts WHERE email=?', (row['email'],)).fetchone())
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])
    def test_suppression_added_during_generation_rolls_back_everything(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        def copy(*args):
            with app.db() as c:
                c.execute("INSERT OR IGNORE INTO contacts(name,email,status) VALUES('Anna',?,'unsubscribed')", (row['email'],))
            return 'Subject', 'Body'
        self.manager.ai_copy = copy
        with self.assertRaises(ValueError):
            self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0], 1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)
            self.assertEqual(c.execute('SELECT status FROM contacts WHERE email=?', (row['email'],)).fetchone()[0], 'unsubscribed')
        self.assertFalse(self.manager.lock.locked())

    def test_generation_failure_preserves_results_and_creates_no_contacts(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        with patch.object(self.manager, 'ai_copy', side_effect=ValueError('quota')):
            with self.assertRaises(ValueError):
                self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0], 1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0], 1)
        self.assertEqual(self.manager.get_run(run_id)['status'], 'error')
        self.assertEqual(self.manager.get_run(run_id)['error'], 'quota')

    def test_draft_endpoint_returns_while_generation_is_pending_and_reports_progress(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        entered, proceed, second = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def slow_copy(*args):
            calls.append(args)
            if len(calls) == 1:
                entered.set()
                if not proceed.wait(5):
                    raise ValueError('test timeout')
            else:
                second.set()
                if not finish.wait(5):
                    raise ValueError('test timeout')
            return 'Subject', 'Body'
        finish = threading.Event()
        self.manager.ai_copy = slow_copy
        try:
            result = self.manager.post('draft', {'id': run_id, 'candidate_ids': [row['id']]})
            self.assertEqual(result, {'id': run_id, 'status': 'drafting'})
            self.assertTrue(entered.wait(2))
            pending = self.manager.get_run(run_id)
            self.assertEqual((pending['draft_completed'], pending['draft_total']), (0, 2))
            self.assertIsNone(pending['campaign_id'])
            with self.assertRaises(ValueError):
                self.manager.post('draft', {'id': run_id, 'candidate_ids': [row['id']]})
            proceed.set()
            self.assertTrue(second.wait(2))
            self.assertEqual(self.manager.get_run(run_id)['draft_completed'], 1)
        finally:
            proceed.set()
            finish.set()
            acquired = self.manager.lock.acquire(timeout=5)
            if acquired:
                self.manager.lock.release()
        self.assertTrue(acquired)
        completed = self.manager.get_run(run_id)
        self.assertEqual((completed['status'], completed['draft_completed']), ('ready', 2))
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)
            self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=?', (completed['campaign_id'],)).fetchone()[0], 'draft')

    def test_background_generation_failure_is_visible_and_can_be_retried(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        with patch.object(self.manager, 'ai_copy', side_effect=ValueError('quota')):
            self.manager.post('draft', {'id': run_id, 'candidate_ids': [row['id']]})
            self.assertTrue(self.manager.lock.acquire(timeout=5))
            self.manager.lock.release()
        failed = self.manager.get_run(run_id)
        self.assertEqual((failed['status'], failed['error'], failed['campaign_id']), ('error', 'quota', None))
        result = self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        self.assertIsNotNone(result['campaign_id'])
        self.assertEqual(self.manager.get_run(run_id)['error'], '')

    def test_busy_mailbox_cannot_block_draft_saving_indefinitely(self):
        run_id = self.setup_run()
        row = self.search(run_id)
        self.verify(run_id)
        self.manager.mail_lock = Mock()
        self.manager.mail_lock.acquire.return_value = False
        with self.assertRaisesRegex(ValueError, 'Poczta'):
            self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        self.manager.mail_lock.acquire.assert_called_once_with(timeout=30)
        self.manager.mail_lock.release.assert_not_called()
        failed = self.manager.get_run(run_id)
        self.assertEqual(failed['status'], 'error')
        self.assertIsNone(failed['campaign_id'])
        self.assertFalse(self.manager.lock.locked())
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)

    def test_excluded_companies_and_existing_contacts_are_not_returned(self):
        run_id = self.setup_run(exclusions='buyer.example')
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', side_effect=self.provider) as provider:
            self.manager.search(run_id)
            self.assertEqual(provider.call_count, 1)
        other_id = self.setup_run()
        with app.db() as c:
            app.add_contact(c, {'email': 'anna@buyer.example'})
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', side_effect=self.provider), patch.object(app.library, 'page', side_effect=ValueError('unavailable')):
            self.manager.search(other_id)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM prospect_candidates').fetchone()[0], 0)

    def test_inferred_addresses_and_unsafe_sources_are_skipped(self):
        for provenance, uri in [('inferred', 'https://buyer.example/team'), ('found', 'javascript:alert(1)')]:
            run_id = self.setup_run()
            def provider(endpoint, params=None, body=None):
                result = self.provider(endpoint, params, body)
                if endpoint == 'domain-search':
                    result['data']['emails'][0].update(provenance=provenance, sources=[{'uri': uri}])
                return result
            with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', side_effect=provider), patch.object(app.library, 'page', side_effect=ValueError('unavailable')):
                self.manager.search(run_id)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM prospect_candidates').fetchone()[0], 0)

    def test_verification_pending_old_and_accept_all_do_not_become_valid(self):
        run_id = self.setup_run()
        self.search(run_id)
        for data in ({'status': 'pending'}, {'status': 'valid', 'verification': {'date': '2000-01-01'}}, {'status': 'valid', 'accept_all': True, 'verification': {'date': datetime.now(timezone.utc).strftime('%Y-%m-%d')}}):
            with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key'}), patch('prospecting.Hunter.request', return_value={'data': data}):
                self.manager.verify(run_id)
            with app.db() as c:
                self.assertNotEqual(c.execute('SELECT verification_status FROM prospect_candidates').fetchone()[0], 'valid')

    def test_key_validation_save_failure_and_no_credential_errors(self):
        for key in ('', 'test-api-key', 'key\ninvalid'):
            with self.assertRaises(ValueError):
                prospecting.Hunter(key)
        with patch('app.ROOT', Path(self.temp.name)), patch('prospecting.Hunter.request', side_effect=ValueError('auth')):
            with self.assertRaises(ValueError):
                app.connect_hunter({'api_key': 'private-fixture-key'})
            self.assertFalse((Path(self.temp.name)/'.env').exists())
        with patch('prospecting.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError('https://api.hunter.io/?api_key=secret-key', 429, 'secret-key', {}, io.BytesIO(b'secret-key'))
            with self.assertRaises(ValueError) as raised:
                prospecting.Hunter('secret-key').request('discover', body={'query': 'Retail'})
            self.assertNotIn('secret-key', str(raised.exception))

    def test_startup_marks_interrupted_jobs_without_repeating_calls(self):
        run_id = self.setup_run()
        app.init()
        self.assertEqual(self.manager.get_run(run_id)['status'], 'interrupted')

    def test_company_bounds_and_wrong_run_candidate_ids(self):
        with self.assertRaises(ValueError):
            self.setup_run(company_limit=100)
        run_id = self.setup_run()
        row = self.search(run_id)
        other_id = self.setup_run()
        self.manager.update(other_id, status='ready')
        with self.assertRaises(ValueError):
            self.manager.draft({'id': other_id, 'candidate_ids': [row['id']]})

    def test_hunter_request_contract_and_pending_response(self):
        with patch('prospecting.urllib.request.build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'{"data": [], "meta": {"filters": {}}}'
            result = prospecting.Hunter('private-fixture-key').request('discover', body={'query': 'Retail in Poland', 'limit': 3})
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(urlparse(request.full_url).netloc, 'api.hunter.io')
            self.assertEqual(urlparse(request.full_url).path, '/v2/discover')
            self.assertEqual(parse_qs(urlparse(request.full_url).query)['api_key'], ['private-fixture-key'])
            self.assertEqual(request.get_method(), 'POST')
            self.assertEqual(json.loads(request.data), {'query': 'Retail in Poland', 'limit': 3})
            self.assertEqual(result['data'], [])
            response.status = 202
            self.assertEqual(prospecting.Hunter('private-fixture-key').request('email-verifier', {'email': 'a@buyer.example'})['data']['status'], 'pending')

    def test_connect_and_disconnect_preserve_other_settings(self):
        target = Path(self.temp.name) / '.env'
        target.write_text('SMTP_HOST=smtp.example.com\nOPENAI_API_KEY=private-openai\n', encoding='utf-8')
        with patch('app.ROOT', Path(self.temp.name)), patch('prospecting.Hunter.request', return_value={'data': {}}) as request:
            app.connect_hunter({'api_key': 'private-fixture-key'})
            request.assert_called_once_with('account')
            self.assertIn('HUNTER_API_KEY=private-fixture-key', target.read_text())
            self.assertTrue(self.manager.state()['hunter'] if hasattr(self, 'manager') else app.prospector.state()['hunter'])
            app.connect_hunter({'disconnect': True})
            self.assertNotIn('private-fixture-key', target.read_text())
            self.assertIn('SMTP_HOST=smtp.example.com', target.read_text())
            self.assertIn('OPENAI_API_KEY=private-openai', target.read_text())

    def test_ai_qualification_uses_evidence_and_preserves_uncertainty(self):
        run_id = self.setup_run()
        with patch.dict(os.environ, {'HUNTER_API_KEY': 'fixture-key', 'OPENAI_API_KEY': 'fixture-openai'}), patch('prospecting.Hunter.request', side_effect=self.provider), patch.object(app.library, 'page', return_value={'url': 'https://buyer.example/', 'summary': 'Buyer operates online shops.'}), patch('prospecting.ai_service.generate_json', return_value={'qualification': 'uncertain', 'fit_reason': 'Retail fits, size not known.', 'missing_data': 'Headcount'}) as generate:
            self.manager.search(run_id)
            self.assertEqual(generate.call_args.args[1]['evidence']['company_summary'], 'Buyer operates online shops.')
        with app.db() as c:
            candidate = c.execute('SELECT * FROM prospect_candidates').fetchone()
            self.assertEqual(candidate['qualification'], 'uncertain')
            self.assertEqual(candidate['missing_data'], 'Headcount')

    def test_assistant_and_message_languages_are_independent_in_search_and_draft(self):
        languages.save_preferences(app.db, {'ui_language': 'en', 'message_language': 'de'})
        run_id = self.setup_run()
        run = self.manager.get_run(run_id)
        self.assertEqual((run['language'], run['assistant_language']), ('de', 'en'))
        row = self.search(run_id)
        self.assertIn('Fit requires review', row['fit_reason'])
        self.verify(run_id)
        languages.save_preferences(app.db, {'message_language': 'fr'})
        result = self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT language FROM campaigns WHERE id=?', (result['campaign_id'],)).fetchone()[0], 'de')
            message = c.execute('SELECT * FROM messages WHERE campaign_id=? AND position=0', (result['campaign_id'],)).fetchone()
            self.assertIn('Guten Tag', message['body'])
        explicit = self.setup_run(language='it')
        self.assertEqual(self.manager.get_run(explicit)['language'], 'it')

    def test_selling_points_persist_and_reach_generation_and_campaign(self):
        run_id = self.setup_run(pain_points='Manual order entry\nSlow delivery updates', value_props='Automated order routing\nShipment visibility', proof_points='Published case study — https://seller.example/case')
        row = self.search(run_id)
        self.verify(run_id)
        seen = []
        def copy(contact, campaign, step):
            seen.append(dict(campaign))
            return 'Subject', 'Body'
        self.manager.ai_copy = copy
        result = self.manager.draft({'id': run_id, 'candidate_ids': [row['id']]})
        self.assertEqual(seen[0]['pain_points'], 'Manual order entry\nSlow delivery updates')
        self.assertEqual(seen[0]['value_props'], 'Automated order routing\nShipment visibility')
        with app.db() as c:
            campaign = c.execute('SELECT * FROM campaigns WHERE id=?', (result['campaign_id'],)).fetchone()
            self.assertEqual(campaign['pain_points'], seen[0]['pain_points'])
            self.assertEqual(campaign['value_props'], seen[0]['value_props'])
            self.assertEqual(campaign['proof_points'], 'Published case study — https://seller.example/case')
            self.assertEqual(seen[0]['proof_points'], campaign['proof_points'])
