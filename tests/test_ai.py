import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
import ai_service
import test_app


class OpenAITests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def response(self, content, status='completed'):
        return io.BytesIO(json.dumps({'status': status, 'output': [
            {'type': 'reasoning', 'summary': []},
            {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(content)}]}
        ]}).encode())

    def test_responses_request_and_structured_result(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-test', 'OPENAI_MODEL': 'gpt-6-luna'}), patch('ai_service.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = self.response({'subject': 'Test', 'body': 'Hello'})
            result = ai_service.generate_json('Trusted instructions', {'contact': 'Anna'}, ('subject', 'body'))
            request = opener.return_value.open.call_args.args[0]
            payload = json.loads(request.data)
            self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
            self.assertEqual(request.get_header('Authorization'), 'Bearer sk-test')
            self.assertFalse(payload['store'])
            self.assertTrue(payload['text']['format']['strict'])
            self.assertEqual(payload['instructions'], 'Trusted instructions')
            self.assertEqual(json.loads(payload['input']), {'contact': 'Anna'})
            self.assertEqual(result['body'], 'Hello')

    def test_auth_and_quota_errors_never_expose_provider_body(self):
        for code in (401, 429, 500):
            with self.subTest(code=code), patch('ai_service.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = urllib.error.HTTPError('url', code, 'sk-secret', {}, io.BytesIO(b'sk-secret'))
                with self.assertRaises(ValueError) as raised:
                    ai_service.generate_json('Test', {}, ('status',), api_key='sk-secret')
                self.assertNotIn('sk-secret', str(raised.exception))

    def test_web_search_requires_tool_execution_and_returns_provenance(self):
        raw={'status':'completed','output':[
            {'type':'web_search_call','action':{'sources':[{'type':'url','url':'https://acme.example/'}]}},
            {'type':'message','content':[{'type':'output_text','text':json.dumps({'website':'https://acme.example/'}),'annotations':[{'type':'url_citation','url':'https://acme.example/careers'}]}]}]}
        with patch('ai_service.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(json.dumps(raw).encode())
            result=ai_service.generate_json('Search',{},('website',),api_key='sk-test',web_search=True)
            payload=json.loads(opener.return_value.open.call_args.args[0].data)
        self.assertEqual(payload['tools'],[{'type':'web_search'}])
        self.assertEqual(payload['tool_choice'],'required')
        self.assertIn('web_search_call.action.sources',payload['include'])
        self.assertEqual(result['sources'],['https://acme.example/','https://acme.example/careers'])

    def test_web_search_does_not_accept_ungrounded_model_memory(self):
        with patch('ai_service.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=self.response({'website':'https://guess.example/'})
            with self.assertRaises(ValueError):ai_service.generate_json('Search',{},('website',),api_key='sk-test',web_search=True)

    def test_optional_values_accept_null_empty_and_whitespace_but_keep_required_fields_strict(self):
        for missing in (None,'','   '):
            with self.subTest(missing=missing),patch('ai_service.urllib.request.build_opener') as opener:
                opener.return_value.open.return_value=self.response({'website':'https://acme.example/','rss':missing})
                result=ai_service.generate_json('Find',{},('website','rss'),api_key='sk-test',optional_fields=('rss',))
                payload=json.loads(opener.return_value.open.call_args.args[0].data)
                self.assertEqual(result['rss'],'')
                self.assertEqual(payload['text']['format']['schema']['properties']['rss']['type'],['string','null'])
                self.assertIn('rss',payload['text']['format']['schema']['required'])
        with patch('ai_service.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=self.response({'website':'','rss':None})
            with self.assertRaises(ai_service.InvalidAIOutput) as raised:
                ai_service.generate_json('Find',{},('website','rss'),api_key='sk-test',optional_fields=('rss',))
            self.assertIn('website',str(raised.exception))

    def test_optional_fields_still_reject_non_strings_and_missing_keys(self):
        for data in ({'reason':'Valid','rss':5},{'reason':'Valid','rss':[]},{'reason':'Valid'}):
            with self.subTest(data=data),patch('ai_service.urllib.request.build_opener') as opener:
                opener.return_value.open.return_value=self.response(data)
                with self.assertRaises(ai_service.InvalidAIOutput):ai_service.generate_json('Find',{},('reason','rss'),api_key='sk-test',optional_fields=('rss',))

    def test_empty_search_results_are_a_valid_no_findings_response(self):
        raw={'status':'completed','output':[{'type':'web_search_call','action':{'sources':[]}},
            {'type':'message','content':[{'type':'output_text','text':json.dumps({'website':None,'reason':'No results'})}]}]}
        with patch('ai_service.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(json.dumps(raw).encode())
            result=ai_service.generate_json('Search',{},('website','reason'),api_key='sk-test',web_search=True,optional_fields=('website',))
        self.assertEqual(result,{'data':{'website':'','reason':'No results'},'sources':[]})

    def test_incomplete_refused_or_invalid_output_fails(self):
        responses = [self.response({'body': 'hello'}, 'incomplete'), self.response({'body': 5}),
                     self.response({'body': ''}), self.response({'wrong': 'x'}),
                     io.BytesIO(json.dumps({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'refusal', 'refusal': 'No'}]}]}).encode())]
        for response in responses:
            with self.subTest(response=response), patch('ai_service.urllib.request.build_opener') as opener:
                opener.return_value.open.return_value = response
                with self.assertRaises(ValueError):
                    ai_service.generate_json('Test', {}, ('body',), api_key='sk-test')

    def test_connect_saves_only_after_success_and_disconnect_preserves_mail(self):
        target = Path(self.temp.name) / '.env'
        target.write_text('SMTP_HOST=smtp.example.com\n', encoding='utf-8')
        with patch('app.ROOT', Path(self.temp.name)), patch('app.ai_service.generate_json', side_effect=ValueError('Failed')):
            with self.assertRaises(ValueError):
                app.connect_openai({'api_key': 'sk-test'})
            self.assertNotIn('OPENAI_API_KEY', target.read_text())
        with patch('app.ROOT', Path(self.temp.name)), patch('app.ai_service.generate_json', return_value={'status': 'OK'}):
            app.connect_openai({'api_key': 'sk-test', 'model': 'gpt-6-luna'})
            self.assertTrue(ai_service.ready())
            self.assertIn('OPENAI_API_KEY=sk-test', target.read_text())
            app.connect_openai({'disconnect': True})
            self.assertFalse(ai_service.ready())
            self.assertNotIn('sk-test', target.read_text())
            self.assertIn('SMTP_HOST=smtp.example.com', target.read_text())

    def test_copy_uses_openai_and_preview_stays_offline(self):
        with app.db() as c:
            contact = dict(c.execute('SELECT * FROM contacts').fetchone())
            campaign = dict(c.execute('SELECT * FROM campaigns').fetchone())
            step = dict(c.execute('SELECT * FROM steps').fetchone())
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-test'}), patch('app.ai_service.generate_json', return_value={'subject': 'Hello\r\nAnna', 'body': 'Personalized'}) as generate:
            self.assertEqual(app.ai_copy(contact, campaign, step), ('Hello Anna', 'Personalized'))
            generate.assert_called_once()
            generate.reset_mock()
            self.assertEqual(app.ai_copy(contact, campaign, step, use_ai=False)[0], 'Dla Acme')
            generate.assert_not_called()

    def test_failed_generation_preserves_existing_drafts(self):
        app.prepare(1)
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-test'}), patch('app.ai_service.generate_json', side_effect=ValueError('quota')):
            with self.assertRaises(ValueError):
                app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)
            self.assertEqual(c.execute('SELECT subject FROM messages WHERE position=0').fetchone()[0], 'Dla Acme')

    def test_refine_offer_and_audience_preserve_constraints_and_use_chosen_language(self):
        for field, language in [('offer', 'de'), ('audience', 'en')]:
            with self.subTest(field=field), patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'text': 'Improved text'}) as generate:
                self.assertEqual(app.refine_text({'field': field, 'text': 'Original with 10 employees, exclude retailers', 'language': language}), {'text': 'Improved text'})
                self.assertEqual(generate.call_args.args[1]['text'], 'Original with 10 employees, exclude retailers')
                self.assertIn('Zachowaj sens', generate.call_args.args[0])
                self.assertIn('nieufne dane', generate.call_args.args[0])
                self.assertIn('niemiecku' if language=='de' else 'angielsku', generate.call_args.args[0])
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0], 1)

    def test_refine_validates_input_and_keeps_provider_failures_explicit(self):
        with patch('app.ai_service.generate_json') as generate:
            for item in ({'field': 'other', 'text': 'text'}, {'field': 'offer', 'text': ''}, {'field': 'audience', 'text': 'a'*3001}):
                with self.assertRaises(ValueError):
                    app.refine_text(item)
            with self.assertRaisesRegex(ValueError, 'Podłącz OpenAI'):
                app.refine_text({'field': 'offer', 'text': 'Original'})
            generate.assert_not_called()
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'text': 'a'*3001}):
            with self.assertRaises(ValueError):
                app.refine_text({'field': 'audience', 'text': 'Original'})

    def test_selling_points_suggestions_are_bounded_and_do_not_save_drafts(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'pain_points': ' Manual order entry\nSlow delivery updates ', 'value_props': 'Automated order routing\nShipment visibility'}) as generate:
            result = app.selling_points({'offer': 'Logistics automation', 'audience': 'Retailers', 'language': 'en'})
            self.assertEqual(result['pain_points'], 'Manual order entry\nSlow delivery updates')
            self.assertIn('Nie wymyślaj', generate.call_args.args[0])
            self.assertEqual(generate.call_args.args[1]['offer'], 'Logistics automation')
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch('app.ai_service.generate_json', return_value={'pain_points': '\n'.join(['point']*11), 'value_props': 'value'}):
            with self.assertRaises(ValueError):
                app.selling_points({'offer': 'Logistics automation'})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0], 1)

    def test_proof_points_are_grounded_in_fetched_quotes_and_urls(self):
        root = {'url': 'https://sender.example/', 'summary': 'Client project results', 'excerpt': 'We delivered 120 projects. Certified ISO 27001.', 'links': []}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', return_value=root), patch('app.ai_service.generate_json', return_value={'proof_points': 'https://sender.example/\tWe delivered 120 projects.'}):
            result = app.proof_points_from_website({'website': 'sender.example'})
            self.assertEqual(result['proof_points'], 'We delivered 120 projects. — https://sender.example/')
            self.assertEqual(result['sources'][0]['url'], root['url'])
        for output in ('https://sender.example/\tWe delivered 999 projects.', 'https://other.example/\tWe delivered 120 projects.', 'No source provided'):
            with self.subTest(output=output), patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', return_value=root), patch('app.ai_service.generate_json', return_value={'proof_points': output}):
                with self.assertRaises(ValueError):
                    app.proof_points_from_website({'website': 'sender.example'})
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', return_value=root), patch('app.ai_service.generate_json', return_value={'proof_points': 'NONE'}):
            self.assertEqual(app.proof_points_from_website({'website': 'sender.example'})['proof_points'], '')

    def test_proof_scan_uses_only_same_domain_evidence_pages(self):
        root = {'url': 'https://sender.example/', 'summary': 'Our services', 'excerpt': 'Our services', 'links': [
            ('https://other.example/case-study', 'Case study'), ('/login', 'Log in'), ('/case-study', 'Case study')]}
        case = {'url': 'https://sender.example/case-study', 'summary': 'Delivered 120 projects.', 'excerpt': 'Delivered 120 projects.', 'links': []}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'fixture'}), patch.object(app.library, 'page', side_effect=[root, case]) as fetch, patch('app.ai_service.generate_json', return_value={'proof_points': 'https://sender.example/case-study\tDelivered 120 projects.'}):
            result = app.proof_points_from_website({'website': 'sender.example'})
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(fetch.call_args.args[0], case['url'])
            self.assertIn(case['url'], result['proof_points'])
