import json
import time
import unittest
from unittest.mock import patch

import app
import campaign_messages
import campaign_workspace
import delivery_status
import test_app


class DeliveryStatusTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def inspect(self):
        with app.db() as c:
            campaign=c.execute('SELECT * FROM campaigns WHERE id=1').fetchone()
            rows=[dict(row) for row in c.execute('SELECT * FROM messages WHERE campaign_id=1 ORDER BY position')]
            summary=delivery_status.annotate(c,campaign,rows,now=self.now)
        return rows,summary

    def prepare(self):
        self.now=time.time()
        app.prepare(1)
        with app.db() as c:c.execute('UPDATE messages SET due=0')

    def test_explains_start_pause_and_missing_smtp_without_writing(self):
        self.prepare()
        rows,summary=self.inspect()
        self.assertEqual(summary['reasons'],{'not_started':2})
        self.assertTrue(all(row['next_attempt_at'] is None for row in rows))
        with app.db() as c:c.execute("UPDATE campaigns SET status='paused'")
        self.assertEqual(self.inspect()[1]['reasons'],{'paused':2})
        with app.db() as c:c.execute("UPDATE campaigns SET status='active'")
        with patch.dict(app.os.environ,{'SMTP_HOST':''}):
            self.assertEqual(self.inspect()[1]['reasons'],{'smtp_missing':2})
        with app.db() as c:self.assertEqual([row[0] for row in c.execute('SELECT status FROM messages')],['queued','queued'])

    def test_previous_step_and_followup_relative_to_actual_send(self):
        self.prepare()
        with app.db() as c:c.execute("UPDATE campaigns SET status='active'")
        rows,summary=self.inspect()
        self.assertEqual([row['delivery_reason'] for row in rows],['ready','previous_step'])
        with app.db() as c:c.execute("UPDATE messages SET status='sent',sent_at=? WHERE position=0",(self.now-60,))
        rows,_=self.inspect()
        self.assertEqual(rows[1]['delivery_reason'],'scheduled')
        self.assertEqual(rows[1]['next_attempt_at'],self.now-60+3*86400)

    def test_global_daily_limit_and_interval_return_earliest_attempt(self):
        self.prepare()
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active'")
            c.execute("INSERT INTO campaigns(id,name,offer,audience,created) VALUES(2,'Other','Offer','IT',0)")
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(2,1,0,'S','B',0,'sent',?)",(self.now-10,))
        with patch.dict(app.os.environ,{'DAILY_SEND_LIMIT':'1'}):
            rows,summary=self.inspect()
            self.assertEqual(rows[0]['delivery_reason'],'daily_limit')
            self.assertGreater(rows[0]['next_attempt_at'],self.now)
            self.assertEqual(summary['sent_today'],1)
        with patch.dict(app.os.environ,{'SEND_INTERVAL_SECONDS':'90'}):
            rows,_=self.inspect()
            self.assertEqual(rows[0]['delivery_reason'],'interval')
            self.assertEqual(rows[0]['next_attempt_at'],self.now+80)
        with patch.dict(app.os.environ,{'DAILY_SEND_LIMIT':'0'}):
            self.assertIsNone(self.inspect()[0][0]['next_attempt_at'])

    def test_contact_simulation_conditions_and_project_simulation(self):
        self.prepare()
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active'")
            c.execute("UPDATE contacts SET status='replied' WHERE id=1")
        self.assertEqual(self.inspect()[0][0]['delivery_reason'],'contact_inactive')
        with app.db() as c:c.execute("UPDATE contacts SET status='active',simulated=1 WHERE id=1")
        self.assertEqual(self.inspect()[0][0]['delivery_reason'],'simulated_contact')
        with app.db() as c:
            c.execute('UPDATE contacts SET simulated=0 WHERE id=1')
            c.execute('UPDATE campaigns SET conditions=?',(json.dumps([{'field':'role','operator':'is_set','value':''}]),))
        self.assertEqual(self.inspect()[0][0]['delivery_reason'],'condition')
        with app.db() as c:c.execute("INSERT OR REPLACE INTO app_preferences(key,value) VALUES('data_simulation','on')")
        self.assertEqual(self.inspect()[0][0]['delivery_reason'],'simulation')

    def test_both_message_views_expose_same_reason_and_queue_summary_is_complete(self):
        self.prepare()
        page=campaign_messages.page(app.db,1)
        workspace=campaign_workspace.read(app.db,1)
        by_id={row['id']:row for row in page['messages']}
        for row in workspace['recipients'][0]['messages']:
            self.assertEqual(row['delivery_reason'],by_id[row['id']]['delivery_reason'])
        self.assertEqual(workspace['delivery']['reasons'],{'not_started':2})
