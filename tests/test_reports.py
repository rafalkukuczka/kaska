import unittest
from datetime import datetime
from pathlib import Path
import app
import diagnostics
import reports
import shared_project
import test_app


class ReportTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_error_report_counts_rotated_logs_and_failed_runs_without_recent_limit(self):
        now=1800000000
        directory=Path(self.temp.name)
        stamp=datetime.fromtimestamp(now-300).strftime('%Y-%m-%d %H:%M:%S')
        (directory/'katie.log.1').write_text((f'{stamp},000 ERROR worker Fixture error\n'*205)
                                             +f'{stamp},000 INFO worker Healthy\n',encoding='utf-8')
        with app.db() as c:
            c.execute("INSERT INTO opportunity_searches(project_id,signature,request,status,total,created,updated) VALUES(1,'fixture','{}','partial',1,?,?)",(now-300,now-300))
            self.assertEqual(diagnostics.error_report(directory,c,now-86400,now),
                             [((now-300)//3600*3600,206)])
            self.assertEqual(diagnostics.error_report(directory,c,now-200,now),[])

    def test_complete_history_ranges_current_queue_and_project_isolation(self):
        now=1800000000
        other=shared_project.create(app.db,{'name':'Other','share_contacts':True})
        with app.db() as c:
            c.execute("INSERT INTO campaigns(id,name,offer,audience,created,project_id) VALUES(2,'Other','Offer','All',0,?)",(other['id'],))
            c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at,deleted) VALUES(1,1,?,'Hello','Body',0,'sent',?,1)",((i,now-3*86400) for i in range(2051)))
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,1,3000,'Old','Body',0,'sent',?)",(now-60*86400,))
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status) VALUES(1,1,3001,'Queued','Body',0,'queued')")
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status) VALUES(1,1,3002,'Unknown','Body',0,'uncertain')")
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(2,1,0,'Other','Body',0,'sent',?)",(now-100,))
            c.execute("UPDATE campaigns SET status='deleted' WHERE id=1")
            for i in range(2):c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Reply','Body',?,?,1)",(now-100,str(i)))
        shared_project.select(app.db,{'project_id':1})
        with app.db() as c:
            short=reports.read(c,7,now);long=reports.read(c,90,now)
        self.assertEqual(short['flow']['contacted'],1)
        self.assertEqual(short['flow']['reply_rate'],100)
        self.assertEqual(short['flow']['days'],7)
        self.assertEqual(sum(count for _,count in short['activity']['sent']),2051)
        self.assertEqual(short['campaigns'],[{'id':1,'name':'Test','status':'deleted','sent':2051,'contacted':1,'queued':1,'uncertain':1}])
        self.assertEqual(long['campaigns'][0]['sent'],2052)
        shared_project.select(app.db,{'project_id':other['id']})
        with app.db() as c:result=reports.read(c,7,now)
        self.assertEqual([row['id'] for row in result['campaigns']],[2])
        self.assertEqual(result['campaigns'][0]['sent'],1)
        self.assertEqual(result['flow']['reply_rate'],0)

    def test_invalid_ranges_and_simulated_contacts(self):
        now=1800000000
        with app.db() as c:
            for value in (0,-1,8,365,'invalid'):
                with self.subTest(value=value),self.assertRaises((ValueError,TypeError)):reports.read(c,value,now)
            c.execute('UPDATE contacts SET simulated=1 WHERE id=1')
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(1,1,0,'Fake','Body',0,'sent',?)",(now-100,))
            c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(1,'Fake','Body',?,'fake',1)",(now-10,))
            result=reports.read(c,7,now)
        self.assertEqual(result['flow']['contacted'],0)
        self.assertEqual(result['activity'],{'sent':[],'replies':[]})
        self.assertEqual(result['campaigns'][0]['sent'],0)
        self.assertIsNone(result['flow']['engagement_rate'])
        self.assertIsNone(result['flow']['bounce_rate'])


if __name__=='__main__':unittest.main()
