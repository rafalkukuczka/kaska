import io
import json
import os
import time
import unittest
import urllib.error
from unittest.mock import Mock, patch

import test_app
import app
import contact_enrichment as ce
import shared_project
import test_prospecting


def person(email='anna@buyer.example', **fields):
    return dict(value=email, first_name='Anna', last_name='Nowak', type='personal',
                provenance='found', sources=[{'uri':'https://buyer.example/team'}], **fields)


class WaterfallTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'APOLLO_API_KEY':'fixture-apollo'})
        self.env.start()
        self.hunter = Mock()
        self.hunter.request.return_value = {'data':{'emails':[person()]}}

    def tearDown(self): self.env.stop()

    def test_full_hunter_result_skips_apollo_and_excludes_known_emails(self):
        with patch.object(ce.Apollo,'people') as apollo:
            result=ce.waterfall(self.hunter,'buyer.example',1)
            self.assertEqual(len(result['emails']),1);apollo.assert_not_called()
        with patch.object(ce.Apollo,'people',return_value=[person('bob@buyer.example')]) as apollo:
            result=ce.waterfall(self.hunter,'buyer.example',1,exclude=['anna@buyer.example'])
            self.assertEqual(result['emails'][0]['value'],'bob@buyer.example')
            self.assertEqual(apollo.call_args.args[1],1)

    def test_fill_only_missing_and_deduplicate_case_and_unsafe_data(self):
        extra=[person('ANNA@buyer.example'),person('bob@buyer.example'),person('bad@other.example'),
               {**person('unsafe@buyer.example'),'sources':[{'uri':'javascript:alert(1)'}]}]
        with patch.object(ce.Apollo,'people',return_value=extra) as apollo:
            result=ce.waterfall(self.hunter,'buyer.example',2,titles='COO')
        self.assertEqual([p['value'] for p in result['emails']],['anna@buyer.example','bob@buyer.example'])
        self.assertEqual(apollo.call_args.args[1],1)
        self.assertEqual([s['added'] for s in result['enrichment']],[1,1])

    def test_partial_failures_keep_results_and_domain_mismatch_never_falls_back(self):
        with patch.object(ce.Apollo,'people',side_effect=ValueError('Apollo: limit')):
            result=ce.waterfall(self.hunter,'buyer.example',2)
            self.assertEqual(len(result['emails']),1)
            self.assertEqual(result['enrichment'][1]['status'],'error')
        self.hunter.request.side_effect=ValueError('Hunter unavailable')
        with patch.object(ce.Apollo,'people',return_value=[person('bob@buyer.example')]):
            result=ce.waterfall(self.hunter,'buyer.example',2)
            self.assertEqual(len(result['emails']),1)
        self.hunter.request.side_effect=None
        self.hunter.request.return_value={'data':{'domain':'wrong.example','emails':[]}}
        with patch.object(ce.Apollo,'people') as apollo,self.assertRaises(ValueError):
            ce.waterfall(self.hunter,'buyer.example',2)
        apollo.assert_not_called()

    def test_apollo_uses_official_endpoints_and_bounded_enrichment(self):
        calls=[]
        def request(endpoint,body):
            calls.append((endpoint,body))
            if endpoint=='mixed_people/api_search':return {'people':[{'id':'id1'},{'id':'id2'},{'id':'id3'}]}
            return {'person':{'email':'bob@buyer.example','email_status':'verified','first_name':'Bob',
                'last_name':'Smith','title':'CTO','organization':{'primary_domain':'buyer.example'}}}
        with patch.object(ce.Apollo,'request',side_effect=request):
            result=ce.Apollo().people('buyer.example',1,'CTO, CIO')
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][1]['q_organization_domains_list'],['buyer.example'])
        self.assertEqual(calls[0][1]['person_titles'],['CTO','CIO'])
        self.assertFalse(calls[1][1]['reveal_personal_emails']);self.assertFalse(calls[1][1]['reveal_phone_number'])
        self.assertEqual(result[0]['provider'],'Apollo')
        self.assertEqual(result[0]['sources'][0]['kind'],'provider')

    def test_apollo_rejects_unknown_email_and_wrong_current_employer(self):
        for status,domain in [('unverified','buyer.example'),('verified','other.example')]:
            def request(endpoint,body):
                return {'people':[{'id':'id1'}]} if endpoint=='mixed_people/api_search' else {'person':{
                    'email':'bob@buyer.example','email_status':status,'organization':{'primary_domain':domain}}}
            with patch.object(ce.Apollo,'request',side_effect=request):
                self.assertEqual(ce.Apollo().people('buyer.example',1),[])

    def test_apollo_keeps_successful_contact_when_next_lookup_is_rate_limited(self):
        payload={'first_name':'Bob','last_name':'Smith','email':'bob@buyer.example','email_status':'verified',
                 'organization':{'primary_domain':'buyer.example'}}
        with patch.object(ce.Apollo,'request',side_effect=[{'people':[{'id':'id1'},{'id':'id2'}]},
                {'person':payload},ValueError('Apollo: limit')]):
            apollo=ce.Apollo();result=apollo.people('buyer.example',2)
        self.assertEqual(len(result),1);self.assertEqual(apollo.warning,'Apollo: limit')

    def test_http_auth_header_and_sanitized_errors(self):
        response=Mock();response.read.return_value=b'{"healthy":true,"is_logged_in":true}'
        response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        opener=Mock();opener.open.return_value=response
        with patch('contact_enrichment.urllib.request.build_opener',return_value=opener):
            self.assertTrue(ce.Apollo().request('auth/health')['is_logged_in'])
        request=opener.open.call_args.args[0]
        self.assertNotIn('fixture-apollo',request.full_url)
        self.assertEqual(request.get_header('X-api-key'),'fixture-apollo')
        opener.open.side_effect=urllib.error.HTTPError('https://api.apollo.io',429,'secret-raw-error',{},io.BytesIO())
        with patch('contact_enrichment.urllib.request.build_opener',return_value=opener),self.assertRaises(ValueError) as error:
            ce.Apollo().request('auth/health')
        self.assertNotIn('secret',str(error.exception));self.assertNotIn('fixture-apollo',str(error.exception))


class PipelineTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown
    setup_run=test_prospecting.ProspectingTests.setup_run
    provider=test_prospecting.ProspectingTests.provider

    def test_search_combines_provider_evidence_and_verifies_without_creating_campaign(self):
        run=self.setup_run()
        with patch.dict(os.environ,{'HUNTER_API_KEY':'fixture-key','APOLLO_API_KEY':'fixture-apollo'}),\
             patch('prospecting.Hunter.request',side_effect=self.provider),\
             patch.object(app.library,'page',return_value={'url':'https://buyer.example/','summary':'Retail'}),\
             patch.object(ce.Apollo,'people',return_value=[{**person('bob@buyer.example'),'provider':'Apollo'}]):
            # execute owns and releases the operation lock, just like the background worker.
            self.manager.lock.acquire()
            self.manager.execute(run,'search')
        result=self.manager.get_run(run)
        self.assertEqual(result['status'],'ready')
        self.assertEqual(len(json.loads(result['filters'])['pipeline']),1)
        with app.db() as c:
            rows=c.execute('SELECT * FROM prospect_candidates WHERE run_id=?',(run,)).fetchall()
            self.assertEqual(len(rows),2)
            self.assertEqual({json.loads(r['evidence'])['contact_provider'] for r in rows},{'Hunter','Apollo'})
            self.assertTrue(all(r['verification_status']=='valid' for r in rows))
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)


    def test_verification_failure_keeps_candidates_unverified_and_visible(self):
        run=self.setup_run()
        def provider(endpoint,params=None,body=None):
            if endpoint=='email-verifier':raise ValueError('Hunter: exhausted credits')
            return self.provider(endpoint,params,body)
        with patch.dict(os.environ,{'HUNTER_API_KEY':'fixture-key'}),patch('prospecting.Hunter.request',side_effect=provider),patch.object(app.library,'page',side_effect=ValueError('unavailable')):
            self.manager.lock.acquire();self.manager.execute(run,'search')
        self.assertEqual(self.manager.get_run(run)['status'],'ready')
        with app.db() as c:
            row=c.execute('SELECT * FROM prospect_candidates').fetchone()
            self.assertEqual(row['verification_status'],'unverified');self.assertIn('exhausted',row['error'])
        self.assertIn('exhausted',self.manager.get_run(run)['warnings'])

    def test_apollo_settings_never_save_invalid_key_and_state_has_only_boolean(self):
        with patch('app.save_config') as save,patch.object(ce.Apollo,'request',return_value={'is_logged_in':False}):
            with self.assertRaises(ValueError):app.connect_apollo({'api_key':'fixture-apollo'})
            save.assert_not_called()
        with patch('app.save_config') as save,patch.object(ce.Apollo,'request',return_value={'healthy':True,'is_logged_in':True}):
            app.connect_apollo({'api_key':'fixture-apollo'})
            save.assert_called_once_with({'APOLLO_API_KEY':'fixture-apollo'})
        with patch.dict(os.environ,{'APOLLO_API_KEY':'fixture-apollo'}):
            run=self.setup_run();state=self.manager.state()
            self.assertTrue(state['apollo']);self.assertNotIn('fixture-apollo',json.dumps(state))
