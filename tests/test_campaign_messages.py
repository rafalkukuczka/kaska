import unittest
import campaign_messages
import app
import test_app


class MessageTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_pagination_includes_messages_beyond_workspace_limit_and_clamps(self):
        with app.db() as c:
            c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due) VALUES(1,1,?,'Subject','Body',0)",((i,) for i in range(2051)))
        result=campaign_messages.page(app.db,1,206,10)
        self.assertEqual(result['total'],2051)
        self.assertEqual(len(result['messages']),1)
        self.assertEqual(result['messages'][0]['position'],0)
        self.assertEqual(campaign_messages.page(app.db,1,999,100)['page'],21)
        for size in (0,7,10000):
            with self.assertRaises(ValueError):campaign_messages.page(app.db,1,1,size)

    def test_removal_cancels_followups_and_keeps_delivery_history(self):
        app.prepare(1)
        with app.db() as c:ids=[row[0] for row in c.execute('SELECT id FROM messages ORDER BY position')]
        result=campaign_messages.remove(app.db,{'campaign_id':1,'ids':[ids[0],ids[0]]})
        self.assertEqual(result['deleted'],1)
        self.assertEqual(result['cancelled_followups'],1)
        visible=campaign_messages.page(app.db,1)['messages']
        self.assertEqual(len(visible),1)
        self.assertEqual(visible[0]['status'],'cancelled')
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)
            c.execute("UPDATE messages SET status='sent',message_id='<history>',sent_at=123 WHERE id=?",(ids[1],))
        campaign_messages.remove(app.db,{'campaign_id':1,'ids':[ids[1]]})
        with app.db() as c:
            row=c.execute('SELECT * FROM messages WHERE id=?',(ids[1],)).fetchone()
            self.assertEqual((row['status'],row['message_id'],row['sent_at']),('sent','<history>',123))
        self.assertEqual(campaign_messages.page(app.db,1)['total'],0)

    def test_active_sending_wrong_campaign_and_invalid_batch_are_rejected(self):
        app.prepare(1)
        with app.db() as c:
            ids=[row[0] for row in c.execute('SELECT id FROM messages')]
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
        with self.assertRaises(ValueError):campaign_messages.remove(app.db,{'campaign_id':1,'ids':ids})
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='paused' WHERE id=1")
            c.execute("UPDATE messages SET status='sending' WHERE id=?",(ids[0],))
        for values in (ids,[ids[1],999999],[True],[],[-1]):
            with self.subTest(values=values),self.assertRaises(ValueError):campaign_messages.remove(app.db,{'campaign_id':1,'ids':values})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT SUM(deleted) FROM messages').fetchone()[0],0)
            c.execute("INSERT INTO campaigns(id,name,offer,audience,created) VALUES(2,'Other','Offer','ICP',0)")
        with self.assertRaises(ValueError):campaign_messages.remove(app.db,{'campaign_id':2,'ids':[ids[1]]})
