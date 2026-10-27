import copy
import unittest
from unittest.mock import patch

import app
import languages
import shared_project
import test_app


class DiscoverContactTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def seed(self):
        signal=app.signal_engine.record({'scope':'market','topic':'ERP','kind':'erp','title':'Acme ERP project','evidence':'Acme announced ERP.','url':'https://example.com/erp'})
        with app.db() as c:
            c.execute('INSERT INTO signal_project_companies(signal_id,project_id,company,reason,quote) VALUES(?,1,?,?,?)',(signal,'Acme','ERP support','Acme announced ERP.'))
        return {'domain':'acme.example','organization':'Acme','emails':[
            {'value':'new@acme.example','first_name':'New','last_name':'Person','type':'personal','provenance':'found','position':'COO','sources':[{'uri':'https://acme.example/team'}]},
            {'value':'anna@example.com','first_name':'Anna','type':'personal','sources':[{'uri':'https://example.com/team'}]}]}

    def search(self,data=None,**fields):
        payload=self.seed() if data is None else data
        with patch('discover_contacts.Hunter') as hunter:
            hunter.return_value.request.return_value={'data':payload}
            result=app.discover_contact_finder.search({'company':'Acme',**fields})
            return result,hunter.return_value.request.call_args.args[1]

    def test_actual_search_only_imports_selected_contacts_and_keeps_evidence(self):
        result,params=self.search()
        self.assertEqual(params['company'],'Acme')
        self.assertEqual(params['provenance'],'found')
        self.assertEqual(len(result['contacts']),1)
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)
        added=app.discover_contact_finder.add({'id':result['id'],'selected':[0,0],'target_group':'Manufacturers','confirm_company':True})
        self.assertEqual(added['added'],1)
        with app.db() as c:
            contact=c.execute("SELECT * FROM contacts WHERE email='new@acme.example'").fetchone()
            self.assertEqual(contact['target_group'],'Manufacturers')
            self.assertIn('https://acme.example/team',contact['notes'])
            self.assertIn('Acme announced ERP.',contact['notes'])
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)

    def test_individual_contact_tags_and_atomic_validation(self):
        data=self.seed();data['emails'][1]['value']='second@acme.example'
        result,_=self.search(data)
        args={'id':result['id'],'selected':[0,1],'tags_by_contact':{'new@acme.example':['First'],'second@acme.example':['Second']},'confirm_company':True}
        with self.assertRaises(ValueError):
            app.discover_contact_finder.add({**args,'tags_by_contact':{'new@acme.example':['First'],'second@acme.example':['x'*101]}})
        with app.db() as c:self.assertEqual(c.execute("SELECT COUNT(*) FROM contacts WHERE email IN ('new@acme.example','second@acme.example')").fetchone()[0],0)
        self.assertEqual(app.discover_contact_finder.add(args)['added'],2)
        with app.db() as c:
            self.assertEqual(c.execute("SELECT target_group FROM contacts WHERE email='new@acme.example'").fetchone()[0],'First')
            self.assertEqual(c.execute("SELECT target_group FROM contacts WHERE email='second@acme.example'").fetchone()[0],'Second')
        languages.save_data_simulation(app.db,{'enabled':True})
        people=[{'name':'One','email':'one@demo.example'},{'name':'Two','email':'two@demo.example'}]
        app.discover_contact_finder.add_simulated({'contacts':people,'company':'Demo','confirm_company':True,'tags_by_contact':{'one@demo.example':['One tag'],'two@demo.example':['Two tag']}})
        with app.db() as c:
            self.assertEqual(c.execute("SELECT target_group FROM contacts WHERE email='one@demo.example'").fetchone()[0],'One tag')
            self.assertEqual(c.execute("SELECT target_group FROM contacts WHERE email='two@demo.example'").fetchone()[0],'Two tag')

    def test_existing_unsubscribed_contact_can_change_group_without_reactivation(self):
        data=self.seed();data['domain']='example.com';data['emails']=data['emails'][1:]
        result,_=self.search(data)
        with app.db() as c:c.execute("UPDATE contacts SET status='unsubscribed',notes='Keep notes' WHERE email='anna@example.com'")
        args={'id':result['id'],'selected':[0],'target_group':'Existing group','confirm_company':True}
        self.assertEqual(app.discover_contact_finder.add(args)['existing'],1)
        app.discover_contact_finder.add({**args,'target_group':''})
        with app.db() as c:
            contact=c.execute("SELECT * FROM contacts WHERE email='anna@example.com'").fetchone()
            self.assertEqual((contact['status'],contact['notes'],contact['target_group']),('unsubscribed','Keep notes','Existing group'))

    def test_unsourced_inferred_generic_and_malformed_contacts_are_excluded(self):
        data=self.seed();person=data['emails'][0];data['emails']=[]
        for changes in ({'sources':[]},{'sources':{}},{'sources':'bad'},{'sources':[{'uri':'javascript:alert(1)'}]}, {'type':'generic'},{'provenance':'inferred'},{'value':'wrong@elsewhere.example'},{'first_name':'','last_name':''}):
            data['emails'].append({**copy.deepcopy(person),**changes})
        self.assertEqual(self.search(data,limit=10)[0]['contacts'],[])

    def test_domain_override_validation_and_request_options(self):
        data=self.seed()
        result,params=self.search(data,domain='https://www.acme.example/about',titles='CEO,COO',limit=2)
        self.assertEqual(params['domain'],'acme.example');self.assertNotIn('company',params)
        self.assertEqual(params['job_titles'],'CEO,COO')
        with self.assertRaises(ValueError):self.search(data,domain='wrong.example')
        for fields in ({'limit':True},{'limit':11},{'domain':'bad'},{'titles':[]},{'company':'Other company'}):
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.search(data,**fields)

    def test_import_requires_stored_results_confirmation_valid_selection_and_project(self):
        result,_=self.search();args={'id':result['id'],'selected':[0],'confirm_company':True}
        for changes in ({'confirm_company':False},{'selected':[]},{'selected':[True]},{'selected':[100]},{'id':99999}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):app.discover_contact_finder.add({**args,**changes})
        other=shared_project.create(app.db,{'name':'Other'})
        with self.assertRaises(ValueError):app.discover_contact_finder.add({**args,'project_id':other['id']})
        with app.db() as c:c.execute('UPDATE discover_contact_searches SET created=0 WHERE id=?',(result['id'],))
        with self.assertRaises(ValueError):app.discover_contact_finder.add({**args,'project_id':1})

    def test_simulation_does_not_call_hunter_or_write_results(self):
        self.seed();languages.save_data_simulation(app.db,{'enabled':True})
        with patch('discover_contacts.Hunter') as hunter,self.assertRaises(ValueError):app.discover_contact_finder.search({'company':'Acme'})
        hunter.assert_not_called()
        with app.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM discover_contact_searches').fetchone()[0],0)

    def test_persist_simulation_contacts_to_named_list_with_validation_and_deduplication(self):
        item={'company':'Demo Company','contacts':[{'name':'Demo Person','email':'contact@demo.example','role':'CEO'}],'target_group':'Demo list','confirm_company':True}
        with self.assertRaises(ValueError):app.discover_contact_finder.add_simulated(item)
        languages.save_data_simulation(app.db,{'enabled':True})
        for change in ({'confirm_company':False},{'target_group':''},{'contacts':[]},{'contacts':[{'name':'Real','email':'person@real.com'}]}):
            with self.subTest(change=change),self.assertRaises(ValueError):app.discover_contact_finder.add_simulated({**item,**change})
        self.assertEqual(app.discover_contact_finder.add_simulated(item)['added'],1)
        app.init()
        with app.db() as c:
            row=c.execute("SELECT * FROM contacts WHERE email='contact@demo.example'").fetchone()
            self.assertEqual((row['target_group'],row['simulated']),('Demo list',1))
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=?",(row['id'],))
        self.assertEqual(app.discover_contact_finder.add_simulated({**item,'target_group':'Updated list'})['existing'],1)
        with app.db() as c:
            row=c.execute("SELECT * FROM contacts WHERE email='contact@demo.example'").fetchone()
            self.assertEqual((row['target_group'],row['status'],row['simulated']),('Updated list','unsubscribed',1))
        # An existing manually entered record is never silently reclassified as simulated.
        with app.db() as c:app.add_contact(c,{'email':'manual@demo.example','target_group':'Real list'})
        app.discover_contact_finder.add_simulated({**item,'contacts':[{'name':'Manual','email':'manual@demo.example'}]})
        with app.db() as c:
            row=c.execute("SELECT simulated,target_group FROM contacts WHERE email='manual@demo.example'").fetchone()
            self.assertEqual(tuple(row),(0,'Real list'))

    def test_persisted_simulation_contacts_never_enter_live_messages_or_source_discovery(self):
        languages.save_data_simulation(app.db,{'enabled':True})
        app.discover_contact_finder.add_simulated({'company':'Fake Company','contacts':[{'name':'Demo','email':'fake@demo.example'}],'target_group':'Demo list','confirm_company':True})
        self.assertNotIn('Fake Company',app.signal_engine.contact_companies())
        app.prepare(1)
        with app.db() as c:
            fake=c.execute("SELECT id FROM contacts WHERE email='fake@demo.example'").fetchone()[0]
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages WHERE contact_id=?',(fake,)).fetchone()[0],0)
            c.execute("UPDATE campaigns SET audience_mode='group',target_group='Demo list' WHERE id=1")
        with self.assertRaises(ValueError):app.prepare(1)
        with app.db() as c:
            c.execute('DELETE FROM messages')
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,status,due) VALUES(1,?,0,'Test','Test','queued',0)",(fake,))
        with patch('app.smtp_ready',return_value=True),patch('app.smtplib.SMTP') as smtp:
            app.send_one();smtp.assert_not_called()
