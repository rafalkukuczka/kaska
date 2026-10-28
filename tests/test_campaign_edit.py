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
