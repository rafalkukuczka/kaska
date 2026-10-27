import json
import time
import unittest
from unittest.mock import patch
import test_app
import app
import sales_signals as ss
import data_connectors as dc


class ConnectorTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def source(self,kind='greenhouse',**config):
        config={'board':'acme',**config} if kind in ('greenhouse','lever') else config
        sid=app.signal_engine.source({'kind':kind,'company':'Acme','config':config})
        with app.db() as c:return c.execute('SELECT * FROM signal_sources WHERE id=?',(sid,)).fetchone()

    def test_provider_configuration_is_generated_and_validated(self):
        for kind in dc.PROVIDERS:
            source=self.source(kind)
            self.assertTrue(source['url'].startswith('https://'))
            self.assertFalse(source['auto_accept'])
            self.assertEqual(self.source(kind)['id'],source['id'])
        for config in ({'board':'https://internal/path'},{'board':'../admin'},{'board':'x','region':'other'}):
            with self.assertRaises(ValueError):dc.configure({'kind':'lever','company':'Acme','config':config})
        with self.assertRaises(ValueError):dc.configure({'kind':'gdelt','company':'Acme','config':{'search_term':'Acme" OR other'}})

    def test_greenhouse_job_signals_and_publication_date(self):
        source=self.source()
        published=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        payload={'jobs':[{'title':'Senior Software Engineer','absolute_url':'https://example.com/jobs/123','first_published':published,'updated_at':published,'location':{'name':'Remote'}},{'title':'Account Executive','absolute_url':'https://example.com/jobs/456','updated_at':published}], 'meta':{'total':2}}
        with patch('data_connectors._fetch',return_value=(json.dumps(payload),source['url'],False)):
            result=app.signal_engine.scan(source['id'])
            self.assertEqual(result['created'],2)
            self.assertEqual(app.signal_engine.scan(source['id'])['created'],0)
        with app.db() as c:
            signals=c.execute('SELECT * FROM sales_signals ORDER BY id').fetchall()
            self.assertEqual([s['kind'] for s in signals],['it_hiring','sales_hiring'])
            self.assertIsNone(signals[0]['occurred'])
            self.assertIsNotNone(signals[0]['source_date'])
            self.assertIsNone(signals[1]['source_date'])
            self.assertEqual(c.execute('SELECT last_total FROM signal_sources').fetchone()[0],2)

    def test_lever_normalizes_epoch_milliseconds_and_eu_endpoint(self):
        source=self.source('lever',region='eu')
        self.assertIn('api.eu.lever.co',source['url'])
        payload=[{'text':'Marketing Manager','hostedUrl':'https://jobs.eu.lever.co/acme/1','createdAt':time.time()*1000,'descriptionPlain':'Build the marketing team.'}]
        with patch('data_connectors._fetch',return_value=(json.dumps(payload),source['url'],False)):
            result=dc.load(source)
        self.assertEqual(result['items'][0]['kind'],'marketing_hiring')
        self.assertLess(abs(result['items'][0]['source_date']-time.time()),2)

    def test_lever_pagination_has_fixed_host_and_bounded_count(self):
        source=self.source('lever')
        row={'text':'Engineer','hostedUrl':'https://jobs.lever.co/acme/1','createdAt':time.time()*1000}
        calls=[]
        def fetch(url,kind):
            calls.append(url)
            return json.dumps([row]*25 if len(calls)==1 else [row]),url,False
        with patch('data_connectors._fetch',side_effect=fetch):batch=dc.load(source)
        self.assertEqual(batch['total'],26)
        self.assertEqual(len(calls),2)
        self.assertIn('skip=25',calls[1])
        self.assertTrue(all(url.startswith('https://api.lever.co/') for url in calls))

    def test_google_news_filters_headlines_and_preserves_original_link(self):
        source=self.source('google_news',search_term='Acme',days=7)
        date=time.strftime('%a, %d %b %Y %H:%M:%S GMT',time.gmtime())
        rss=f'<rss><channel><item><title>Acme has a new CEO</title><link>https://news.google.com/rss/articles/1</link><pubDate>{date}</pubDate></item><item><title>Other company has a new CEO</title><link>https://news.google.com/rss/articles/2</link></item></channel></rss>'
        with patch('data_connectors._fetch',return_value=(rss,source['url'],False)):
            batch=dc.load(source)
            self.assertEqual(batch['total'],2)
            self.assertEqual(len(batch['items']),1)
            result=app.signal_engine.scan(source['id'])
        self.assertEqual(result['created'],1)
        with app.db() as c:
            signal=c.execute('SELECT * FROM sales_signals').fetchone()
            self.assertEqual(signal['kind'],'new_ceo')
            self.assertIsNone(signal['occurred'])
            self.assertEqual(signal['source_date_kind'],'publication')
            self.assertIn('news.google.com',signal['url'])

    def test_gdelt_index_time_not_claimed_as_event_date(self):
        source=self.source('gdelt')
        payload={'articles':[{'title':'Acme acquires NewCo','url':'https://example.com/deal','seendate':time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())},{'title':'Other new CEO','url':'https://example.com/other'},{'title':'Acme funding round','url':'http://example.com/insecure'}]}
        with patch('data_connectors._fetch',return_value=(json.dumps(payload),source['url'],False)):
            batch=dc.load(source)
            self.assertEqual(len(batch['items']),1)
            result=app.signal_engine.scan(source['id'])
        self.assertEqual(result['created'],1)
        with app.db() as c:
            signal=c.execute('SELECT * FROM sales_signals').fetchone()
            self.assertEqual(signal['source_date_kind'],'indexing')
            self.assertIsNone(signal['occurred'])

    def test_rate_limit_persists_backoff_and_no_false_empty_success(self):
        source=self.source('gdelt')
        retry=time.time()+300
        with patch('data_connectors._fetch',side_effect=dc.ConnectorError('HTTP 429',retry)) as fetch:
            result=app.signal_engine.scan(source['id'])
            self.assertEqual(len(result['errors']),1)
            self.assertEqual(len(app.signal_engine.scan(source['id'],force=True)['errors']),1)
            self.assertEqual(fetch.call_count,1)
        with app.db() as c:
            row=c.execute('SELECT * FROM signal_sources').fetchone()
            self.assertIsNone(row['last_success'])
            self.assertEqual(row['next_retry'],retry)
            self.assertIsNone(row['last_total'])

    def test_http_retry_after_is_translated_to_connector_backoff(self):
        url='https://api.gdeltproject.org/test-'+str(time.time())
        with patch('data_connectors._LAST',{}),patch('sales_signals.fetch_public',side_effect=ss.FetchError(429,600)):
            with self.assertRaises(dc.ConnectorError) as result:dc._fetch(url,'gdelt')
        self.assertGreaterEqual(result.exception.retry_at,time.time()+599)

    def test_cache_reuses_read_only_responses(self):
        with patch('data_connectors._CACHE',{}),patch('data_connectors._LAST',{}),patch('sales_signals.fetch_public',return_value=('{}','https://example.com/data')) as fetch:
            self.assertFalse(dc._fetch('https://example.com/data','greenhouse')[2])
            self.assertTrue(dc._fetch('https://example.com/data','greenhouse')[2])
            self.assertEqual(fetch.call_count,1)

    def test_empty_feed_is_success_but_malformed_is_error(self):
        source=self.source()
        with patch('data_connectors._fetch',return_value=('{}',source['url'],False)):
            self.assertEqual(len(app.signal_engine.scan(source['id'])['errors']),1)
        with app.db() as c:c.execute('UPDATE signal_sources SET next_retry=NULL')
        with patch('data_connectors._fetch',return_value=('{"jobs":[]}',source['url'],False)):
            result=app.signal_engine.scan(source['id'])
            self.assertEqual(result['errors'],[])
        with app.db() as c:self.assertEqual(c.execute('SELECT last_total FROM signal_sources').fetchone()[0],0)

    def test_old_published_job_is_not_treated_as_new_observation(self):
        source=self.source()
        payload={'jobs':[{'title':'Engineer','absolute_url':'https://example.com/job','first_published':'2020-01-01T00:00:00Z'}]}
        with patch('data_connectors._fetch',return_value=(json.dumps(payload),source['url'],False)):
            self.assertEqual(app.signal_engine.scan(source['id'])['created'],0)

    def test_configuration_url_tampering_is_rejected(self):
        source=dict(self.source());source['url']='https://other.example/data'
        with self.assertRaises(ValueError):dc.load(source)


if __name__=='__main__':unittest.main()
