import unittest
import app
import dashboard_activity
import shared_project
import test_app


class DashboardActivityTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_flow_deduplicates_people_and_excludes_simulated_and_future_data(self):
        now=1800000000
        with app.db() as c:
            c.execute("INSERT INTO contacts(id,name,email) VALUES(2,'Potential','potential@example.com')")
            c.execute("INSERT INTO contacts(id,name,email,status) VALUES(3,'Opt out','out@example.com','unsubscribed')")
            c.execute("INSERT INTO contacts(id,name,email,simulated) VALUES(4,'Simulation','fake@demo.example',1)")
            c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,?,?,'Subject','Body',0,'sent',?)",[(1,0,now-1000),(1,1,now-500),(4,0,now-1000),(2,0,now+1000)])
            c.executemany("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Reply','Body',?,?,1)",[(now-200,'reply1'),(now-100,'reply2')])
            result=dashboard_activity.flow(c,1,now)
        self.assertEqual((result['potential'],result['contacted'],result['replied'],result['reply_rate']),(1,1,1,100.0))
        self.assertIsNone(result['engagement_rate']);self.assertIsNone(result['bounce_rate'])
        other=shared_project.create(app.db,{'name':'Shared pool','share_contacts':True})
        with app.db() as c:result=dashboard_activity.flow(c,other['id'],now)
        self.assertEqual((result['potential'],result['contacted'],result['replied']),(2,0,0))
        self.assertIsNone(result['reply_rate'])

    def test_flow_only_counts_responses_after_a_recent_send_in_this_project(self):
        now=1800000000
        with app.db() as c:
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,1,0,'Subject','Body',0,'sent',?)",(now-1000,))
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Earlier reply','Body',?,'earlier',1)",(now-2000,))
            self.assertEqual(dashboard_activity.flow(c,1,now)['reply_rate'],0.0)
        other=shared_project.create(app.db,{'name':'Other','share_contacts':True})
        with app.db() as c:
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Other reply','Body',?,'other',?)",(now-100,other['id']))
            self.assertEqual(dashboard_activity.flow(c,1,now)['reply_rate'],0.0)
            self.assertEqual(dashboard_activity.flow(c,1,now+8*86400)['contacted'],0)

    def test_complete_counts_project_isolation_and_history(self):
        now=1800000000
        with app.db() as c:
            c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,1,?,'Subject','Body',0,'sent',?)",((i,now-7200) for i in range(2051)))
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,1,3000,'Old','Body',0,'sent',?)",(now-92*86400,))
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Reply','Body',?,'activity',1)",(now-3600,))
            # Removing a campaign/message from the UI must preserve its actual send history.
            c.execute("UPDATE campaigns SET status='deleted' WHERE id=1")
            c.execute('UPDATE messages SET deleted=1 WHERE campaign_id=1')
            result=dashboard_activity.read(c,1,now)
        self.assertEqual(sum(count for _,count in result['sent']),2051)
        self.assertEqual(sum(count for _,count in result['replies']),1)
        other=shared_project.create(app.db,{'name':'Other','share_contacts':True})
        with app.db() as c:self.assertEqual(dashboard_activity.read(c,other['id'],now),{'sent':[],'replies':[]})


if __name__=='__main__':unittest.main()
