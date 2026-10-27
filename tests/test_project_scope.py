import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from pathlib import Path
from http.server import ThreadingHTTPServer

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app


class ProjectScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old_db,self.old_port=app.DB,app.PORT
        app.DB=Path(self.temp.name)/'scope.sqlite3';app.init()
        self.copy=patch('app.ai_copy',side_effect=lambda contact,campaign,step:(step['subject'],step['body']))
        self.copy.start()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        app.PORT=self.server.server_address[1]
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.copy.stop()
        app.DB,app.PORT=self.old_db,self.old_port;self.temp.cleanup()

    def request(self,path,data=None,status=200):
        request=urllib.request.Request('http://127.0.0.1:'+str(app.PORT)+'/api/'+path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Content-Type':'application/json','X-CSRF-Token':app.CSRF})
        try:
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status,status);return json.load(response)
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code,status);return json.load(error)

    def create(self,name,shared=False):
        return self.request('seller-projects/create',{'name':name,'share_contacts':shared})['id']

    def select(self,project):self.request('seller-projects/select',{'project_id':project})

    def campaign(self):
        self.request('campaigns',{'name':'Campaign','offer':'Services','audience':'Buyers','audience_mode':'all',
            'steps':[{'delay_days':0,'subject':'Hello','body':'Hello {{name}}'}]})
        return self.request('state')['campaigns'][0]['id']

    def test_shared_pool_private_duplicate_email_and_project_campaigns(self):
        self.request('contacts',{'email':'same@example.com','name':'Shared','tags':['Shared tag']})
        first_campaign=self.campaign()
        shared=self.create('Shared',True)
        snapshot=self.request('state')
        self.assertEqual([row['name'] for row in snapshot['contacts']],['Shared'])
        self.assertEqual(snapshot['campaigns'],[])
        self.request('contacts',{'email':'other@example.com','name':'Other shared'})
        self.select(1);self.assertEqual(self.request('state')['totals']['contacts'],2)
        private=self.create('Private')
        snapshot=self.request('state');self.assertEqual(snapshot['contacts'],[])
        self.assertEqual(snapshot['contact_tags'],[])
        self.request('contacts',{'email':'same@example.com','name':'Private copy','tags':['Private tag']})
        private_campaign=self.campaign()
        # Preparation must use the campaign owner's pool even if the UI selects another project.
        self.select(shared);app.prepare(private_campaign)
        with app.db() as c:
            self.assertEqual([row[0] for row in c.execute('SELECT t.name FROM messages m JOIN contacts t ON t.id=m.contact_id WHERE m.campaign_id=?',(private_campaign,))],['Private copy'])
        self.assertEqual(self.request('state')['campaigns'],[])
        self.select(private);snapshot=self.request('state')
        self.assertEqual([row['name'] for row in snapshot['contacts']],['Private copy'])
        self.assertEqual(snapshot['contact_tags'],['Private tag'])
        self.assertEqual([row['id'] for row in snapshot['campaigns']],[private_campaign])
        another=self.create('Another private');self.assertEqual(self.request('state')['contacts'],[])
        self.select(1);snapshot=self.request('state')
        self.assertEqual([row['id'] for row in snapshot['campaigns']],[first_campaign])
        self.assertEqual(snapshot['totals']['contacts'],2)
        app.init();self.assertEqual(self.request('state')['totals']['contacts'],2)
        with app.db() as c:self.assertEqual(list(c.execute('PRAGMA foreign_key_check')),[])

    def test_cross_project_mutations_and_message_reads_are_rejected(self):
        self.request('contacts',{'email':'first@example.com','tags':['First tag']})
        snapshot=self.request('state');contact=snapshot['contacts'][0]['id'];tag=snapshot['tag_catalog'][0]['id']
        campaign=self.campaign();app.prepare(campaign)
        message=self.request('state')['messages'][0]['id']
        self.create('Isolated')
        for path,data in [('contact/status',{'id':contact,'status':'paused'}),
                          ('contact/tags',{'id':contact,'tags':['Wrong']}),
                          ('contacts/tags/bulk',{'ids':[contact],'tags':['Wrong']}),
                          ('campaign/prepare',{'id':campaign}),('campaign/delete',{'id':campaign}),
                          ('campaign/status',{'id':campaign,'status':'active'}),
                          ('campaign/messages/delete',{'campaign_id':campaign,'ids':[message]}),
                          ('message',{'id':message,'subject':'Wrong','body':'Wrong'}),
                          ('admin/tags',{'id':tag,'action':'delete'})]:
            self.request(path,data,status=400)
        self.request('campaign/messages?campaign_id='+str(campaign),status=400)
        self.select(1)
        self.assertEqual(self.request('state')['contacts'][0]['status'],'active')
        self.assertEqual(self.request('state')['messages'][0]['subject'],'Hello')

    def test_reports_endpoint_validates_ranges_and_uses_selected_project(self):
        self.campaign()
        result=self.request('reports?days=30')
        self.assertEqual(result['days'],30);self.assertEqual(result['project_id'],1)
        self.assertEqual(len(result['campaigns']),1)
        self.request('reports?days=365',status=400)
        other=self.create('Private report')
        result=self.request('reports?days=7&project_id=1')
        self.assertEqual(result['project_id'],other)
        self.assertEqual(result['campaigns'],[])

    def test_legacy_migration_preserves_history_and_uses_an_existing_project(self):
        app.DB=Path(self.temp.name)/'legacy.sqlite3'
        with patch('project_scope.migrate'):app.init()
        with app.db() as c:
            c.execute("INSERT INTO contacts(id,name,email) VALUES(12,'Legacy','legacy@example.com')")
            c.execute("INSERT INTO seller_projects(id,name,data,updated) VALUES(4,'Current','{}',0)")
            c.execute('UPDATE seller_projects SET deleted=1 WHERE id=1')
            c.execute('UPDATE seller_project_selection SET project_id=4')
            c.execute("INSERT INTO campaigns(id,name,offer,audience,status,created) VALUES(8,'Legacy','Offer','Buyers','active',1)")
            c.execute("INSERT INTO messages(id,campaign_id,contact_id,position,subject,body,due,status,message_id) VALUES(9,8,12,0,'Subject','Body',0,'sent','<legacy@example.com>')")
            c.execute("INSERT INTO replies(id,contact_id,subject,body,received,uid) VALUES(5,12,'Reply','Legacy reply',2,'uid')")
        app.init();app.init()
        snapshot=self.request('state')
        self.assertEqual(snapshot['contacts'][0]['id'],12)
        self.assertEqual(snapshot['campaigns'][0]['project_id'],4)
        self.assertEqual(snapshot['campaigns'][0]['status'],'active')
        self.assertEqual(snapshot['messages'][0]['message_id'],'<legacy@example.com>')
        self.assertEqual(snapshot['replies'][0]['body'],'Legacy reply')
        with app.db() as c:self.assertEqual(list(c.execute('PRAGMA foreign_key_check')),[])


if __name__=='__main__':unittest.main()
