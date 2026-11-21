import io
import json
import unittest
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import ai_service
import billable_activity
import openai_usage


class OpenAIUsageTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        database = patch.object(openai_usage,'_database',None)
        database.start()
        self.addCleanup(database.stop)
        self.path = Path(temp.name)/'usage.sqlite3'
        openai_usage.configure(self.path)

    def test_counts_non_overlapping_token_categories_and_web_search(self):
        cost = openai_usage.estimate_usd('gpt-6-luna','default',10_000,2_000,1_000,500,2)
        self.assertEqual(cost,Decimal('0.021095'))

    def test_groups_worker_responses_and_keeps_other_operations_separate(self):
        usage = {'input_tokens':1000,'output_tokens':200}
        response = {'usage':usage,'model':'gpt-6-luna','output':[{'type':'web_search_call'}]}
        for _ in range(2):
            openai_usage.run('lead-search/start','#12',1,openai_usage.record,response,'gpt-6-luna')
        with openai_usage.operation('ai/refine'):
            openai_usage.record({'usage':usage,'model':'unpriced-model'},'gpt-6-luna')
        other, search = openai_usage.recent()
        self.assertIsNone(other['cost_usd'])
        self.assertEqual((search['calls'],search['input_tokens'],search['output_tokens'],search['web_calls']),
                         (2,2000,400,2))
        self.assertEqual(Decimal(search['cost_usd']),Decimal('0.0204'))

    def test_project_report_persists_requests_and_filters_dates_and_projects(self):
        billed = {'model':'gpt-6-luna','usage':{'input_tokens':1000,'output_tokens':200}}
        unknown = {**billed,'model':'unpriced-model'}
        for project, stamp, response in ((1,100,billed),(1,300,billed),(1,301,unknown),(2,302,billed)):
            with patch('openai_usage.time.time',return_value=stamp), openai_usage.operation('ai/refine',project_id=project):
                openai_usage.record(response,'gpt-6-luna',duration_ms=1250)
        openai_usage.configure(self.path)
        report = openai_usage.report(1,200,400)
        self.assertEqual([row['created'] for row in report['requests']],[301,300])
        self.assertEqual(report['requests'][1]['duration_ms'],1250)
        self.assertEqual(report['totals'],{'calls':2,'input_tokens':2000,'output_tokens':400,
                                          'unpriced':1,'cost_usd':'0.0002'})

    def test_records_usage_even_when_provider_reports_incomplete_response(self):
        response = {'status':'incomplete','model':'gpt-6-luna',
                    'usage':{'input_tokens':500,'output_tokens':100}}
        with patch('ai_service.urllib.request.build_opener') as opener, openai_usage.operation('ai/refine'):
            opener.return_value.open.return_value = io.BytesIO(json.dumps(response).encode())
            with self.assertRaisesRegex(ValueError,'nie ukończyło'):
                ai_service.generate_json('Fixture',{},('text',),api_key='fixture-only')
        self.assertEqual(openai_usage.recent()[0]['input_tokens'],500)

    def test_outreach_usage_appears_in_bell_and_project_report_once(self):
        request = {'id':'resp_1','model':'gpt-4.1-mini-2025-04-14','serviceTier':'default',
                   'inputTokens':1000,'outputTokens':100,'cachedTokens':200,'cacheWriteTokens':0,
                   'webCalls':0,'durationMs':150,'created':200}
        payload = {'action':'generate','operationId':'4a10d9c2-8b5f-4934-9007-c3ff02b09a68',
                   'requests':[request,{**request,'id':'resp_2','created':201}]}
        openai_usage.record_outreach(payload,2)
        openai_usage.configure(self.path)
        openai_usage.record_outreach(payload,2)
        bell, = openai_usage.recent()
        self.assertEqual((bell['action'],bell['calls'],bell['cost_usd']),('extension/generate',2,'0.001'))
        report = openai_usage.report(2,100,300)
        self.assertEqual([(row['created'],row['duration_ms']) for row in report['requests']],[(201,150),(200,150)])
        self.assertEqual(openai_usage.report(1,100,300)['totals']['calls'],0)

    def test_billable_indicator_survives_short_calls_and_releases_abandoned_outreach(self):
        operation = {'operationId':'4a10d9c2-8b5f-4934-9007-c3ff02b09a68','active':True}
        with patch.object(billable_activity,'_recent',{}), patch.object(billable_activity,'_outreach',{}), \
                patch('billable_activity.time.monotonic',return_value=10) as clock:
            with billable_activity.track(None):
                self.assertEqual(billable_activity.providers(),[])
            with billable_activity.track('Hunter'):
                self.assertEqual(billable_activity.providers(),['Hunter'])
            billable_activity.outreach(operation)
            self.assertEqual(billable_activity.providers(),['Hunter','OpenAI'])
            billable_activity.outreach({**operation,'active':False})
            self.assertEqual(billable_activity.providers(),['Hunter'])
            billable_activity.outreach(operation)
            clock.return_value += billable_activity.NOTICE_SECONDS
            self.assertEqual(billable_activity.providers(),['OpenAI'])
            clock.return_value += billable_activity.OUTREACH_LEASE_SECONDS
            self.assertEqual(billable_activity.providers(),[])
