import json
import unittest
import threading
import urllib.request
import urllib.error
from unittest.mock import patch

import app
import campaign_workspace
import shared_project
import test_app


class CampaignWorkspaceTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_preflight_rejects_changed_messages_before_activating(self):
        app.prepare(1)
        fingerprint=campaign_workspace.read(app.db,1)['fingerprint']
        with app.db() as c:c.execute("UPDATE messages SET subject='Changed subject' WHERE position=0")
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.object(app,'PORT',server.server_address[1]):
                def post(value):
                    request=urllib.request.Request(f'http://127.0.0.1:{app.PORT}/api/campaign/status',data=json.dumps({'id':1,'status':'active','fingerprint':value}).encode(),headers={'Content-Type':'application/json','X-CSRF-Token':app.CSRF})
                    return urllib.request.urlopen(request,timeout=5)
                with self.assertRaises(urllib.error.HTTPError) as error:post(fingerprint)
                self.assertEqual(error.exception.code,400)
                with app.db() as c:self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0],'draft')
                with patch('app.smtp_ready',return_value=True):
                    with post(campaign_workspace.read(app.db,1)['fingerprint']) as response:self.assertEqual(response.status,200)
        finally:server.shutdown();server.server_close();thread.join()

    def test_recipient_is_one_record_with_all_steps_and_visible_before_preparation(self):
        before=campaign_workspace.read(app.db,1)
        self.assertEqual((before['summary']['recipients'],before['summary']['steps'],before['summary']['messages']),(1,2,0))
        app.prepare(1);after=campaign_workspace.read(app.db,1)
        self.assertEqual(after['total'],1);self.assertEqual(len(after['recipients'][0]['messages']),2)
        self.assertEqual(after['summary']['counts'],{'queued':2})

    def test_complete_counts_do_not_use_global_state_row_limit(self):
        with app.db() as c:
            c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due) VALUES(1,1,?,'Subject','Body',0)",[(index,) for index in range(2051)])
        data=campaign_workspace.read(app.db,1)
        self.assertEqual(data['summary']['messages'],2051)
        self.assertEqual(data['summary']['counts']['queued'],2051)
        self.assertEqual(data['total'],1)

    def test_pagination_project_scope_and_contact_pool(self):
        with app.db() as c:
            for index in range(30):app.add_contact(c,{'name':f'Person {index:02}','email':f'p{index}@example.com'})
        first=campaign_workspace.read(app.db,1,1,10);last=campaign_workspace.read(app.db,1,4,10)
        self.assertEqual((len(first['recipients']),len(last['recipients']),last['total']),(10,1,31))
        shared_project.create(app.db,{'name':'Private'})
        with self.assertRaises(ValueError):campaign_workspace.read(app.db,1)
        for page,size in ((0,10),(1,12)):
            with self.assertRaises(ValueError):campaign_workspace.read(app.db,1,page,size)

    def test_reply_counts_require_exact_campaign_and_history_remains_after_hiding_sent(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE messages SET status='sent',sent_at=100,deleted=1 WHERE position=0")
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id,campaign_id) VALUES(1,'Reply','Body',101,'exact',1,1)")
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Old reply','Body',101,'legacy',1)")
        summary=campaign_workspace.read(app.db,1)['summary']
        self.assertEqual((summary['messages'],summary['sent'],summary['replies'],summary['replied']),(1,1,1,1))

    def test_review_fingerprint_changes_with_content_but_not_delivery_status(self):
        app.prepare(1);before=campaign_workspace.read(app.db,1)['fingerprint']
        with app.db() as c:c.execute("UPDATE messages SET status='sent',sent_at=100 WHERE position=0")
        self.assertEqual(campaign_workspace.read(app.db,1)['fingerprint'],before)
        with app.db() as c:c.execute("UPDATE messages SET body='New text' WHERE position=1")
        self.assertNotEqual(campaign_workspace.read(app.db,1)['fingerprint'],before)
