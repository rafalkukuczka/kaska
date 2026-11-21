import json
import time
import unittest

import app
import campaign_edit
import shared_project
import test_app


class CampaignEditTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def item(self):
        result=campaign_edit.read(app.db,1);campaign=result['campaign']
        return {**campaign,'steps':result['steps'],'contact_ids':json.loads(campaign['contact_ids']),'audience_tags':json.loads(campaign['audience_tags']),'material_ids':json.loads(campaign['material_ids']),'conditions':json.loads(campaign['conditions'])}

    def save(self,item):return campaign_edit.save(app.db,app.library,app.MAIL_LOCK,app.ai_copy,item)

    def test_clone_keeps_configuration_and_starts_without_delivery_history(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("""UPDATE campaigns SET status='active',revision=7,offer_website='https://offer.example',
                offer_sources='["campaign_documents"]',language='de',cta='Demo' WHERE id=1""")
            c.execute("UPDATE messages SET status='sent',sent_at=? WHERE campaign_id=1 AND position=0",(time.time(),))
            c.execute('INSERT INTO campaign_recipient_overrides(campaign_id,contact_id,included) VALUES(1,1,0)')
            c.execute("""INSERT INTO campaign_offer_documents(project_id,scope,name,digest,text)
                VALUES(1,'campaign:1','Oferta.txt','sample','Tekst oferty')""")
        copied = campaign_edit.clone(app.db,{'id':1,'project_id':1})
        campaign = copied['campaign']
        self.assertEqual((campaign['name'],campaign['status'],campaign['revision']),('Kopia Test','draft',1))
        self.assertEqual((campaign['offer_website'],campaign['language'],campaign['cta']),('https://offer.example','de','Demo'))
        self.assertEqual(campaign['offer_sources'],'["campaign_documents"]')
        self.assertIsNone(copied['protected_position'])
        self.assertEqual([step['subject'] for step in copied['steps']],['Dla {{company}}','Powrót'])
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages WHERE campaign_id=?',(campaign['id'],)).fetchone()[0],0)
            self.assertEqual(c.execute('SELECT included FROM campaign_recipient_overrides WHERE campaign_id=?',
                                      (campaign['id'],)).fetchone()[0],0)
            self.assertEqual(c.execute('SELECT text FROM campaign_offer_documents WHERE scope=?',
                                      (f"campaign:{campaign['id']}",)).fetchone()[0],'Tekst oferty')
            self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0],'active')
        self.assertEqual(campaign_edit.clone(app.db,{'id':1})['campaign']['name'],'Kopia Test (2)')
        shared_project.create(app.db,{'name':'Inny projekt'})
        with self.assertRaisesRegex(ValueError,'w tym projekcie'):
            campaign_edit.clone(app.db,{'id':1})

    def test_draft_updates_same_campaign_and_invalidates_prepared_messages(self):
        app.prepare(1);item=self.item();item.update(name='Updated',offer='New services',conditions=[{'field':'email','operator':'is_set','before_step':1}])
        item['steps'][1]['subject']='New follow-up'
        result=self.save(item)
        with app.db() as c:
            campaign=c.execute('SELECT * FROM campaigns WHERE id=1').fetchone()
            self.assertEqual((campaign['name'],campaign['offer'],campaign['status'],campaign['revision']),('Updated','New services','draft',2))
            self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
        self.assertEqual(result['id'],1);app.prepare(1)
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)

    def test_renaming_a_draft_keeps_its_prepared_messages(self):
        self.assertFalse(campaign_edit.read(app.db, 1)['has_queued_messages'])
        app.prepare(1)
        self.assertTrue(campaign_edit.read(app.db, 1)['has_queued_messages'])
        with app.db() as c:
            before = [tuple(row) for row in c.execute('SELECT id,subject,body FROM messages ORDER BY id')]
        item = self.item()
        item['name'] = 'Renamed campaign'
        self.assertTrue(self.save(item)['has_queued_messages'])
        with app.db() as c:
            self.assertEqual([tuple(row) for row in c.execute('SELECT id,subject,body FROM messages ORDER BY id')], before)

    def test_active_edit_pauses_and_preserves_sent_message_and_future_queue_id(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE messages SET status='sent',sent_at=?,message_id='<original>' WHERE position=0",(time.time()-86400,))
            sent=dict(c.execute('SELECT * FROM messages WHERE position=0').fetchone())
            queued=c.execute('SELECT id FROM messages WHERE position=1').fetchone()[0]
        item=self.item();item['steps'][1].update(subject='New {{name}}',body='Updated for {{company}}',delay_days=7)
        self.save(item)
        with app.db() as c:
            self.assertEqual(dict(c.execute('SELECT * FROM messages WHERE position=0').fetchone()),sent)
            future=c.execute('SELECT * FROM messages WHERE position=1').fetchone()
            self.assertEqual((future['id'],future['subject'],future['body']),(queued,'New Anna','Updated for Acme'))
            self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0],'paused')
        item=self.item();item['steps'][0]['body']='Cannot change history'
        with self.assertRaises(ValueError):self.save(item)

    def test_prepare_paused_campaign_adds_missing_steps_and_recipients_without_repeating_history(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE messages SET status='sent',sent_at=? WHERE position=0",(time.time()-86400,))
            sent=dict(c.execute('SELECT * FROM messages WHERE position=0').fetchone())
            app.add_contact(c,{'name':'Bob','email':'bob@example.com'})
        item=self.item();item['steps'].append({'delay_days':7,'subject':'Third','body':'Hello {{name}}'})
        self.save(item);app.prepare(1);app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],6)
            self.assertEqual(dict(c.execute('SELECT * FROM messages WHERE id=?',(sent['id'],)).fetchone()),sent)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM (SELECT contact_id,position FROM messages GROUP BY contact_id,position HAVING COUNT(*)>1)').fetchone()[0],0)

    def test_linkedin_can_switch_to_manual_without_rewriting_confirmed_history(self):
        with app.db() as c:
            c.execute("UPDATE campaigns SET channel='linkedin',status='paused' WHERE id=1")
        app.prepare(1)
        item=self.item()
        item.update(channel='manual', manual_scenarios=[{
            'domain':'linkedin.com', 'start_url':'https://www.linkedin.com/feed/',
            'instructions':'Sprawdź stronę', 'actions':[{'type':'waitFor','selector':'main'}],
        }])
        for pending in ('sending','uncertain'):
            with self.subTest(pending=pending):
                with app.db() as c:
                    c.execute('UPDATE messages SET status=? WHERE campaign_id=1 AND position=0',(pending,))
                with self.assertRaisesRegex(ValueError,'niepotwierdzoną wysyłką'):
                    self.save(item)
                self.assertEqual(self.item()['channel'],'linkedin')
        with app.db() as c:
            c.execute("UPDATE messages SET status='sent',sent_at=? WHERE campaign_id=1 AND position=0",(time.time(),))
            before=[dict(row) for row in c.execute('SELECT * FROM messages WHERE campaign_id=1 ORDER BY position')]

        self.assertEqual(self.save(item)['status'],'paused')

        with app.db() as c:
            campaign=c.execute('SELECT channel,manual_scenarios FROM campaigns WHERE id=1').fetchone()
            self.assertEqual(campaign['channel'],'manual')
            stored = json.loads(campaign['manual_scenarios'])[0]
            self.assertEqual(stored['domain'], 'linkedin.com')
            self.assertIs(stored['dry_run'], True)
            after=[dict(row) for row in c.execute('SELECT * FROM messages WHERE campaign_id=1 ORDER BY position')]
            self.assertEqual(after,before)

    def test_email_can_switch_to_manual_with_confirmed_history(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE messages SET status='sent',sent_at=?,message_id='<email>' WHERE campaign_id=1 AND position=0",
                      (time.time(),))
            sent = dict(c.execute('SELECT * FROM messages WHERE campaign_id=1 AND position=0').fetchone())
        item = self.item()
        item.update(channel='manual', manual_scenarios=[{
            'domain':'example.com', 'start_url':'https://example.com/', 'instructions':'Sprawdź stronę', 'mode':'agent',
        }])
        self.assertEqual(self.save(item)['status'], 'paused')
        with app.db() as c:
            self.assertEqual(c.execute('SELECT channel FROM campaigns WHERE id=1').fetchone()[0], 'manual')
            self.assertEqual(dict(c.execute('SELECT * FROM messages WHERE id=?',(sent['id'],)).fetchone()), sent)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE campaign_id=1 AND status='queued'").fetchone()[0], 1)

    def test_manual_scenario_saves_explicit_sending_mode_and_send_step(self):
        item = self.item()
        actions = [{'type': 'ifVisible', 'selector': 'form', 'then': [
            {'type': 'send', 'selector': '#send-message', 'text': 'Send'},
        ]}]
        item.update(channel='manual', manual_scenarios=[{
            'domain': 'example.com', 'start_url': 'https://example.com/',
            'instructions': 'Wyślij wiadomość', 'dry_run': False, 'actions': actions,
        }])
        self.save(item)
        scenario = json.loads(self.item()['manual_scenarios'])[0]
        self.assertIs(scenario['dry_run'], False)
        self.assertEqual(scenario['actions'][0]['then'], actions[0]['then'])

    def test_manual_agent_request_limit_defaults_and_persists(self):
        item = self.item()
        scenario = {'domain': 'example.com', 'start_url': 'https://example.com/',
                    'instructions': 'Sprawdź stronę', 'mode': 'agent'}
        item.update(channel='manual', manual_scenarios=[scenario])
        self.save(item)
        self.assertEqual(json.loads(self.item()['manual_scenarios'])[0]['agent_max_requests'], 50)

        item = self.item()
        item['manual_scenarios'] = [{**scenario, 'agent_max_requests': 75}]
        self.save(item)
        self.assertEqual(json.loads(self.item()['manual_scenarios'])[0]['agent_max_requests'], 75)

        for invalid in (False, 0, 1.5, '50'):
            with self.subTest(invalid=invalid):
                item = self.item()
                item['manual_scenarios'] = [{**scenario, 'agent_max_requests': invalid}]
                with self.assertRaisesRegex(ValueError, 'Limit wywołań agenta'):
                    self.save(item)

    def test_manual_agent_page_wait_defaults_and_persists(self):
        item = self.item()
        scenario = {'domain': 'example.com', 'start_url': 'https://example.com/',
                    'instructions': 'Sprawdź stronę', 'mode': 'agent'}
        item.update(channel='manual', manual_scenarios=[scenario])
        self.save(item)
        stored = json.loads(self.item()['manual_scenarios'])[0]
        self.assertEqual(stored['agent_page_wait_seconds'], 120)
        self.assertIs(stored['headless'], True)

        item = self.item()
        item['manual_scenarios'] = [{**scenario, 'agent_page_wait_seconds': 45, 'headless': False}]
        self.save(item)
        stored = json.loads(self.item()['manual_scenarios'])[0]
        self.assertEqual(stored['agent_page_wait_seconds'], 45)
        self.assertIs(stored['headless'], False)

        for invalid in (False, 0, 2.5, '120', 2_147_484):
            with self.subTest(invalid=invalid):
                item = self.item()
                item['manual_scenarios'] = [{**scenario, 'agent_page_wait_seconds': invalid}]
                with self.assertRaisesRegex(ValueError, 'czas oczekiwania'):
                    self.save(item)

    def test_stale_revision_invalid_steps_and_foreign_project_do_not_change_campaign(self):
        item=self.item();self.save(item)
        with self.assertRaises(ValueError):self.save(item)
        item=self.item();item['steps'][1]['delay_days']=0
        with self.assertRaises(ValueError):self.save(item)
        shared_project.create(app.db,{'name':'Other'})
        with self.assertRaises(ValueError):campaign_edit.read(app.db,1)
        with self.assertRaises(ValueError):self.save(item)
        with app.db() as c:self.assertEqual(c.execute('SELECT revision FROM campaigns WHERE id=1').fetchone()[0],2)

    def test_changed_recipients_cancel_only_unsent_messages(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE messages SET status='sent',sent_at=? WHERE position=0",(time.time(),))
            app.add_contact(c,{'name':'Bob','email':'bob@example.com'})
            bob=c.execute("SELECT id FROM contacts WHERE email='bob@example.com'").fetchone()[0]
        item=self.item();item.update(audience_mode='selected',contact_ids=[bob]);self.save(item);app.prepare(1)
        with app.db() as c:
            self.assertEqual([row[0] for row in c.execute('SELECT status FROM messages WHERE contact_id=1 ORDER BY position')],['sent','cancelled'])
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages WHERE contact_id=?',(bob,)).fetchone()[0],2)
            self.assertEqual(c.execute('SELECT status FROM contacts WHERE id=1').fetchone()[0],'active')
