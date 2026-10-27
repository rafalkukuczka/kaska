import json
import time
import unittest
from unittest.mock import patch
import test_app
import app
import sales_signals as ss


class SignalTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def record(self,**kwargs):
        item={'company':'Acme','kind':'funding','title':'Acme raised funding','evidence':'Acme secured funding for expansion.','url':'https://example.com/news/round','occurred':time.time()}
        item.update(kwargs)
        return app.signal_engine.record(item)

    def rule(self,**kwargs):
        item={'campaign_id':1,'kinds':['funding'],'min_score':60,'max_age_days':30,'enabled':True}
        item.update(kwargs)
        return app.signal_engine.save_rule(item)

    def source(self,**kwargs):
        item={'name':'Acme feed','kind':'rss','company':'Acme','url':'https://example.com/feed','auto_accept':False}
        item.update(kwargs)
        return app.signal_engine.source(item)

    def scan(self,content,source_id):
        with patch('sales_signals.fetch_public',return_value=(content,'https://example.com/feed')):
            return app.signal_engine.scan(source_id)

    def test_source_deletion_keeps_evidence_and_stops_scanning(self):
        source_id=self.source(kind='json')
        payload=json.dumps([{'company':'Acme','kind':'funding','title':'Acme funding','evidence':'Acme secured funding','url':'https://example.com/funding'}])
        self.assertEqual(self.scan(payload,source_id)['created'],1)
        app.signal_engine.post('source/delete',{'id':source_id})
        self.assertEqual(app.signal_engine.state()['sources'],[])
        self.assertEqual(len(app.signal_engine.state()['items']),1)
        with patch('sales_signals.fetch_public') as fetch:
            self.assertEqual(app.signal_engine.scan(source_id,force=True)['created'],0)
            fetch.assert_not_called()
        with self.assertRaises(ValueError):
            app.signal_engine.post('source/status',{'id':source_id,'enabled':True})
        with app.db() as c:
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
        replacement=self.source(kind='json')
        self.assertNotEqual(replacement,source_id)

    def test_source_signal_type_selection_filters_detected_events(self):
        source_id=self.source(kind='json',signal_kinds=['funding'])
        payload=json.dumps([{'company':'Acme','kind':kind,'title':'Acme '+kind,'evidence':'Confirmed event','url':'https://example.com/'+kind} for kind in ('funding','it_hiring')])
        self.assertEqual(self.scan(payload,source_id)['created'],1)
        self.assertEqual([s['kind'] for s in app.signal_engine.state()['items']],['funding'])
        with self.assertRaises(ValueError):self.source(signal_kinds=['invented'])

    def test_delete_source_during_network_fetch_discards_late_results(self):
        source_id=self.source(kind='json')
        def fetch(*args):
            app.signal_engine.delete_source(source_id)
            return json.dumps([{'company':'Acme','kind':'funding','title':'Acme funding','evidence':'Funding announced','url':'https://example.com/funding'}]),'https://example.com/feed'
        with patch('sales_signals.fetch_public',side_effect=fetch):
            self.assertEqual(app.signal_engine.scan(source_id)['created'],0)
        self.assertEqual(app.signal_engine.state()['items'],[])
        with app.db() as c:
            self.assertIsNone(c.execute('SELECT last_success FROM signal_sources WHERE id=?',(source_id,)).fetchone()[0])

    def test_bulk_sources_use_unique_contact_companies_and_skip_missing_configuration(self):
        with app.db() as c:
            app.add_contact(c,{'email':'second@example.com','company':' acme '})
            app.add_contact(c,{'email':'third@example.com','company':'Buyer'})
            app.add_contact(c,{'email':'empty@example.com','company':'   '})
        result=app.signal_engine.post('sources/from-contacts',{})
        self.assertEqual((result['created'],result['existing'],result['companies']),(4,0,2))
        self.assertEqual(len(result['skipped']),10)
        self.assertEqual({row['kind'] for row in app.signal_engine.state()['sources']},{'google_news','gdelt'})
        self.assertTrue(all(not row['auto_accept'] for row in app.signal_engine.state()['sources']))
        repeated=app.signal_engine.post('sources/from-contacts',{})
        self.assertEqual((repeated['created'],repeated['existing']),(0,4))

    def test_bulk_sources_configure_all_types_without_guessing_board_ids(self):
        result=app.signal_engine.sources_from_contacts({'companies':[{'company':'Acme','greenhouse_board':'https://job-boards.greenhouse.io/acme','lever_board':'https://jobs.eu.lever.co/acme','page_url':'acme.example','rss_url':'acme.example/feed.xml','json_url':'https://acme.example/signals.json'}]})
        self.assertEqual((result['created'],result['skipped']),(7,[]))
        sources=app.signal_engine.state()['sources']
        lever=next(s for s in sources if s['kind']=='lever')
        self.assertEqual(json.loads(lever['config']),{'board':'acme','region':'eu'})
        self.assertTrue(next(s for s in sources if s['kind']=='page')['url'].startswith('https://'))
        self.assertTrue(all(not s['auto_accept'] for s in sources))
        repeated=app.signal_engine.sources_from_contacts({})
        self.assertEqual((repeated['created'],repeated['existing'],repeated['skipped']),(0,7,[]))

    def test_invalid_bulk_configuration_rolls_back_and_unknown_companies_are_rejected(self):
        for payload in (
            {'companies':[{'company':'Acme','lever_board':'https://other.example/acme'}]},
            {'companies':[{'company':'Unknown'}]},
            {'companies':[]},
            {'kinds':['imaginary']},
            {'kinds':[]},
        ):
            with self.subTest(payload=payload),self.assertRaises(ValueError):
                app.signal_engine.sources_from_contacts(payload)
            self.assertEqual(app.signal_engine.state()['sources'],[])

    def test_bulk_sources_preserve_existing_paused_source_settings(self):
        source_id=app.signal_engine.source({'company':'Acme','kind':'google_news','auto_accept':True})
        app.signal_engine.post('source/status',{'id':source_id,'enabled':False})
        result=app.signal_engine.sources_from_contacts({'kinds':['google_news']})
        self.assertEqual((result['created'],result['existing']),(0,1))
        source=app.signal_engine.state()['sources'][0]
        self.assertFalse(source['enabled'])
        self.assertTrue(source['auto_accept'])

    def test_catalog_has_company_and_market_bilingual_detectors(self):
        self.assertEqual(len(ss.CATALOG),53)
        for definition in ss.CATALOG.values():
            for word in definition['keywords']:
                self.assertTrue(ss.has_phrase('Acme '+word+' today',word))
        self.assertTrue(ss.has_phrase('ACME: wdrożenie CRM','wdrozenie crm'))
        self.assertFalse(ss.has_phrase('macmecorp','Acme'))

    def test_market_feed_filters_topic_without_assigning_company(self):
        source_id=self.source(scope='market',topic='NIS2',auto_accept=True)
        content='''<rss><channel>
        <item><title>NIS2: new regulation</title><link>https://example.com/nis2</link></item>
        <item><title>Acme raised funding</title><link>https://example.com/funding</link></item>
        <item><title>NIS2 deadline approaches</title><link>https://example.com/deadline</link></item>
        </channel></rss>'''
        self.assertEqual(self.scan(content,source_id)['created'],2)
        signals=app.signal_engine.state()['items']
        self.assertEqual({s['kind'] for s in signals},{'regulation','market_news'})
        self.assertTrue(all(s['company']=='' and s['topic']=='NIS2' and s['status']=='accepted' for s in signals))
        self.assertTrue(all(s['score']<90 for s in signals))
        # A named company in JSON must not turn a market source into company outreach.
        json_id=self.source(scope='market',topic='NIS2',kind='json')
        payload=json.dumps([{'company':'Acme','title':'Acme NIS2','kind':'funding','evidence':'Acme NIS2 update','url':'https://example.com/acme'}])
        self.assertEqual(self.scan(payload,json_id)['created'],1)
        self.assertEqual(app.signal_engine.state()['items'][0]['company'],'')

    def test_market_acceptance_never_enrolls_even_blank_company_contacts(self):
        with app.db() as c:app.add_contact(c,{'email':'blank@example.com','company':''})
        self.rule(kinds=['regulation'],min_score=0)
        signal_id=self.record(scope='market',company='Acme',topic='NIS2',kind='regulation')
        self.assertEqual(app.signal_engine.status({'id':signal_id,'status':'accepted'}),0)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT company FROM sales_signals WHERE id=?',(signal_id,)).fetchone()[0],'')

    def test_market_source_validation_and_topic_deduplication(self):
        for data in ({'scope':'market','topic':''},{'company':''},{'scope':'unknown'},{'scope':'market','topic':'NIS2','kind':'lever'}):
            with self.subTest(data=data),self.assertRaises(ValueError):self.source(**data)
        first=self.source(scope='market',topic='NIS2')
        self.assertEqual(self.source(scope='market',topic='nis2'),first)
        self.assertNotEqual(self.source(scope='market',topic='ERP'),first)
        for kind in ('google_news','gdelt'):
            source_id=app.signal_engine.source({'scope':'market','topic':'NIS2','kind':kind})
            source=next(s for s in app.signal_engine.state()['sources'] if s['id']==source_id)
            self.assertEqual(source['company'],'')
            self.assertEqual(json.loads(source['config'])['search_term'],'NIS2')
            with patch('data_connectors._fetch',return_value=('<rss><channel><item><title>NIS2 new regulation</title></item></channel></rss>' if kind=='google_news' else json.dumps({'articles':[{'title':'NIS2 new regulation','url':'https://example.com/news'}]}),source['url'],False)):
                self.assertEqual(app.signal_engine.scan(source_id)['created'],1)

    def test_manual_evidence_priority_and_idempotency(self):
        signal_id=self.record()
        self.assertIsNone(self.record())
        with app.db() as c:
            row=c.execute('SELECT * FROM sales_signals').fetchone()
            self.assertEqual(row['id'],signal_id)
            self.assertEqual(row['score'],100)
            self.assertEqual(row['status'],'new')
            self.assertIn('nie pewność',row['explanation'])
        for kwargs in ({'url':'javascript:alert(1)'},{'evidence':''},{'kind':'imaginary'},{'occurred':time.time()+86400*3}):
            with self.assertRaises(ValueError): self.record(**kwargs)

    def test_acceptance_enrolls_only_exact_active_company_and_once(self):
        with app.db() as c:
            for i,(company,status) in enumerate([('Acme Holdings','active'),('Acme','unsubscribed'),('Acme','replied'),('Acme','paused')]):
                app.add_contact(c,{'email':f'test{i}@example.com','company':company})
                c.execute('UPDATE contacts SET status=? WHERE email=?',(status,f'test{i}@example.com'))
            c.execute("UPDATE steps SET body='{{signal_title}} | {{signal_url}}' WHERE position=0")
        self.rule();sid=self.record()
        self.assertEqual(app.signal_engine.apply_rules(),0)
        self.assertEqual(app.signal_engine.status({'id':sid,'status':'accepted'}),1)
        self.assertEqual(app.signal_engine.apply_rules(),0)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM signal_enrollments').fetchone()[0],1)
            self.assertIn('Acme raised funding',c.execute('SELECT body FROM messages WHERE position=0').fetchone()[0])
            self.assertEqual(c.execute('SELECT status FROM campaigns').fetchone()[0],'draft')
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one();smtp.assert_not_called()

    def test_rejecting_enrolled_signal_cancels_queue_and_cannot_duplicate(self):
        self.rule();sid=self.record()
        app.signal_engine.status({'id':sid,'status':'accepted'})
        app.signal_engine.status({'id':sid,'status':'dismissed'})
        with app.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='cancelled'").fetchone()[0],2)
        self.assertEqual(app.signal_engine.status({'id':sid,'status':'accepted'}),0)

    def test_priority_age_type_and_disabled_rule_filters(self):
        self.rule(kinds=['funding'],min_score=100,max_age_days=7)
        for data in ({'kind':'hiring'},{'occurred':time.time()-86400*10},{'company':'No contacts'}):
            sid=self.record(**data)
            self.assertEqual(app.signal_engine.status({'id':sid,'status':'accepted'}),0)
        self.rule(enabled=False)
        sid=self.record(title='Another round')
        self.assertEqual(app.signal_engine.status({'id':sid,'status':'accepted'}),0)
        with self.assertRaises(ValueError):app.prepare(1)

    def test_new_contacts_can_join_active_campaign_after_later_signal(self):
        self.rule();sid=self.record()
        app.signal_engine.status({'id':sid,'status':'accepted'})
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active'")
            app.add_contact(c,{'email':'second@example.com','company':' ACME '})
        self.assertEqual(app.signal_engine.apply_rules(),1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],4)
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            self.assertEqual(smtp.return_value.__enter__.return_value.send_message.call_count,1)

    def test_cannot_attach_rule_to_manual_campaign_queue(self):
        app.prepare(1)
        with self.assertRaises(ValueError):self.rule()

    def test_disabled_and_paused_campaigns_do_not_enroll(self):
        self.rule();sid=self.record()
        with app.db() as c:c.execute("UPDATE campaigns SET status='paused'")
        self.assertEqual(app.signal_engine.status({'id':sid,'status':'accepted'}),0)

    def test_rss_company_matching_stale_entries_and_deduplication(self):
        sid=self.source()
        feed='''<rss><channel><item><title>Acme: new CEO</title><link>https://example.com/ceo</link><description>Acme has appointed CEO Jane.</description></item><item><title>OtherCorp new CEO</title><link>https://example.com/other</link></item><item><title>Acme raised funding</title><pubDate>Wed, 01 Jan 2020 12:00:00 GMT</pubDate></item></channel></rss>'''
        result=self.scan(feed,sid)
        self.assertEqual(result['created'],1)
        self.assertEqual(result['errors'],[])
        self.assertEqual(self.scan(feed,sid)['created'],0)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT kind FROM sales_signals').fetchone()[0],'new_ceo')
            self.assertEqual(c.execute('SELECT status FROM sales_signals').fetchone()[0],'new')

    def test_atom_links_and_dates(self):
        sid=self.source()
        feed='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Acme new CFO</title><link href="https://example.com/cfo"/><summary>New CFO at Acme</summary><updated>2026-10-20T12:00:00Z</updated></entry></feed>'
        # Use the test clock to keep the fixture independent of host date.
        with patch('sales_signals.time.time',return_value=1792497600):
            result=self.scan(feed,sid)
        self.assertEqual(result['errors'],[])
        with app.db() as c:self.assertEqual(c.execute('SELECT url FROM sales_signals').fetchone()[0],'https://example.com/cfo')

    def test_html_baseline_changes_only_no_reorder_false_positive(self):
        sid=self.source(kind='page')
        first='<p>Acme is an established company operating worldwide.</p><p>We are hiring talented people for our team.</p>'
        self.assertEqual(self.scan(first,sid)['created'],0)
        changed=first+'<p>Acme announces a new CEO to lead the global team.</p>'
        self.assertEqual(self.scan(changed,sid)['created'],1)
        self.assertEqual(self.scan(changed,sid)['created'],0)
        self.assertEqual(self.scan(changed.split('</p>')[1]+'</p>'+changed.split('</p>')[0]+'</p>'+changed.split('</p>')[2]+'</p>',sid)['created'],0)

    def test_structured_json_auto_accept_triggers_draft_and_is_atomic(self):
        sid=self.source(kind='json',auto_accept=True)
        self.rule(kinds=['demo_request'])
        data=[{'company':'Acme','kind':'demo_request','title':'Demo request','evidence':'CRM event #123','url':'https://example.com/crm/123'}]
        result=self.scan(json.dumps(data),sid)
        self.assertEqual((result['created'],result['enrolled']),(1,1))
        self.assertEqual(self.scan(json.dumps(data),sid)['enrolled'],0)
        # Invalid later item must roll back earlier inserts from the same poll.
        data[0]['title']='New demo request'
        data.append({'company':'Acme','kind':'invalid','title':'Invalid'})
        result=self.scan(json.dumps(data),sid)
        self.assertEqual(result['created'],0)
        self.assertEqual(len(result['errors']),1)
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sales_signals').fetchone()[0],1)

    def test_xml_entities_private_addresses_and_source_failures(self):
        sid=self.source()
        result=self.scan('<!DOCTYPE rss [<!ENTITY x "oops">]><rss/>',sid)
        self.assertEqual(len(result['errors']),1)
        with patch('sales_signals.socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):ss.fetch_public('https://example.com')
        with app.db() as c:self.assertIsNotNone(c.execute('SELECT last_error FROM signal_sources').fetchone()[0])

    def test_date_timezone_preserved_and_expired_manual_rejected(self):
        self.assertEqual(ss.timestamp('2026-10-20T12:00:00+02:00'),ss.timestamp('2026-10-20T10:00:00Z'))
        with self.assertRaises(ValueError):self.record(occurred=time.time()-100*86400)

    def test_restart_preserves_sources_signals_rules_and_enrollments(self):
        self.source();self.rule();sid=self.record()
        app.signal_engine.status({'id':sid,'status':'accepted'})
        app.init();app.init()
        state=app.signal_engine.state()
        self.assertEqual(len(state['sources']),1)
        self.assertEqual(len(state['items']),1)
        self.assertEqual(len(state['rules']),1)
        self.assertEqual(len(state['enrollments']),1)


if __name__=='__main__':unittest.main()
