import json
import unittest

import app
import contact_tags
import test_app


class ContactTagTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_tags_normalize_deduplicate_and_preserve_status_on_edit(self):
        with app.db() as c:
            app.add_contact(c,{'email':'tags@example.com','tags':' ERP ; Polska; erp ; ; Produkcja '})
            row=c.execute("SELECT * FROM contacts WHERE email='tags@example.com'").fetchone()
            self.assertEqual(json.loads(row['tags']),['ERP','Polska','Produkcja'])
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=?",(row['id'],))
        contact_tags.assign(app.db,{'id':row['id'],'tags':'erp; Finanse'})
        with app.db() as c:
            current=c.execute('SELECT * FROM contacts WHERE id=?',(row['id'],)).fetchone()
            self.assertEqual(json.loads(current['tags']),['ERP','Finanse'])
            self.assertEqual(current['status'],'unsubscribed')
        contact_tags.assign(app.db,{'id':row['id'],'tags':''})
        with app.db() as c:self.assertEqual(c.execute('SELECT tags FROM contacts WHERE id=?',(row['id'],)).fetchone()[0],'[]')
        for value in (None,{},[1],['a;b'],'a\nb','x'*101,';'.join(str(i) for i in range(31))):
            with self.subTest(value=value),self.assertRaises(ValueError):contact_tags.parse(value)

    def test_any_all_matching_recipient_deduplication_and_simulation_exclusion(self):
        with app.db() as c:
            contact_tags.set_tags(c,1,'ERP; Polska')
            app.add_contact(c,{'email':'erp@example.com','tags':'ERP'})
            app.add_contact(c,{'email':'polska@example.com','tags':'Polska'})
            app.add_contact(c,{'email':'other@example.com','tags':'Other'})
            app.add_contact(c,{'email':'paused@example.com','tags':'ERP; Polska'})
            app.add_contact(c,{'email':'fake@demo.example','tags':'ERP; Polska'})
            c.execute("UPDATE contacts SET status='paused' WHERE email='paused@example.com'")
            c.execute("UPDATE contacts SET simulated=1 WHERE email='fake@demo.example'")
            tags,mode=contact_tags.validate_campaign(c,{'audience_mode':'tags','audience_tags':['erp','Polska'],'tag_match':'any'})
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags=?,tag_match=? WHERE id=1",(json.dumps(tags),mode))
        app.prepare(1)
        with app.db() as c:
            people={row[0] for row in c.execute('SELECT DISTINCT t.email FROM messages m JOIN contacts t ON t.id=m.contact_id')}
            self.assertEqual(people,{'anna@example.com','erp@example.com','polska@example.com'})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages WHERE contact_id=1').fetchone()[0],2)
            c.execute("UPDATE campaigns SET tag_match='all' WHERE id=1")
        app.prepare(1)
        with app.db() as c:self.assertEqual({row[0] for row in c.execute('SELECT DISTINCT contact_id FROM messages')},{1})
        with app.db() as c:contact_tags.set_tags(c,1,'Other')
        with self.assertRaises(ValueError):app.prepare(1)

    def test_legacy_list_migration_is_idempotent(self):
        with app.db() as c:
            c.execute("UPDATE contacts SET target_group='Retail',status='paused' WHERE id=1")
            c.execute("UPDATE campaigns SET audience_mode='group',target_group='Retail' WHERE id=1")
            c.execute('ALTER TABLE contacts DROP COLUMN tags')
            c.execute('ALTER TABLE campaigns DROP COLUMN audience_tags')
        app.init()
        with app.db() as c:
            row=c.execute('SELECT tags,status FROM contacts WHERE id=1').fetchone()
            self.assertEqual(json.loads(row['tags']),['Retail']);self.assertEqual(row['status'],'paused')
            campaign=c.execute('SELECT audience_mode,audience_tags FROM campaigns WHERE id=1').fetchone()
            self.assertEqual(campaign['audience_mode'],'tags');self.assertEqual(json.loads(campaign['audience_tags']),['Retail'])
            contact_tags.set_tags(c,1,'Retail; ERP')
        app.init()
        with app.db() as c:self.assertEqual(json.loads(c.execute('SELECT tags FROM contacts WHERE id=1').fetchone()[0]),['Retail','ERP'])

    def test_invalid_campaign_tags_and_no_substring_matches(self):
        with app.db() as c:
            contact_tags.set_tags(c,1,'ERP Plus')
            for data in ({'audience_tags':[]},{'audience_tags':['Missing']},{'audience_tags':['ERP Plus'],'tag_match':'bad'}):
                with self.assertRaises(ValueError):contact_tags.validate_campaign(c,{'audience_mode':'tags',**data})
        self.assertFalse(contact_tags.matches(['ERP Plus'],['ERP']))
        self.assertTrue(contact_tags.matches(['ERP Plus'],['erp plus']))

    def test_signal_enrollment_respects_campaign_tags(self):
        with app.db() as c:
            contact_tags.set_tags(c,1,'ERP')
            app.add_contact(c,{'email':'other@acme.example','company':'Acme','tags':'Other'})
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags='[\"ERP\"]' WHERE id=1")
        app.signal_engine.save_rule({'campaign_id':1,'kinds':['funding'],'min_score':0,'max_age_days':30,'enabled':True})
        signal=app.signal_engine.record({'company':'Acme','kind':'funding','title':'Acme raised funding','evidence':'Acme secured funding for expansion.','url':'https://example.com/funding'})
        self.assertEqual(app.signal_engine.status({'id':signal,'status':'accepted'}),1)
        with app.db() as c:self.assertEqual({row[0] for row in c.execute('SELECT contact_id FROM signal_enrollments')},{1})

    def test_administration_creates_unused_tags_and_renames_assignments_atomically(self):
        created=contact_tags.manage(app.db,{'action':'create','name':'  Industry  '})
        self.assertIn('Industry',contact_tags.names(app.db))
        self.assertEqual(contact_tags.state(app.db)[0]['contacts'],0)
        with self.assertRaises(ValueError):contact_tags.manage(app.db,{'action':'create','name':'industry'})
        with app.db() as c:
            contact_tags.set_tags(c,1,'Industry; ERP')
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=1")
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags='[\"Industry\",\"ERP\"]' WHERE id=1")
        result=contact_tags.manage(app.db,{'action':'rename','id':created['id'],'name':'Manufacturing'})
        self.assertEqual((result['contacts'],result['campaigns']),(1,1))
        with app.db() as c:
            contact=c.execute('SELECT tags,status FROM contacts WHERE id=1').fetchone()
            campaign=c.execute('SELECT audience_tags FROM campaigns WHERE id=1').fetchone()
            self.assertEqual(json.loads(contact['tags']),['Manufacturing','ERP']);self.assertEqual(contact['status'],'unsubscribed')
            self.assertEqual(json.loads(campaign['audience_tags']),['Manufacturing','ERP'])
        with self.assertRaises(ValueError):contact_tags.manage(app.db,{'action':'rename','id':created['id'],'name':'erp'})
        contact_tags.manage(app.db,{'action':'rename','id':created['id'],'name':'MANUFACTURING'})
        app.init();self.assertIn('MANUFACTURING',contact_tags.names(app.db));self.assertNotIn('Industry',contact_tags.names(app.db))

    def test_deleting_tag_keeps_contacts_pauses_campaign_and_never_falls_back_to_all(self):
        with app.db() as c:
            contact_tags.set_tags(c,1,'Retail')
            c.execute("UPDATE campaigns SET audience_mode='tags',audience_tags='[\"Retail\"]' WHERE id=1")
        app.prepare(1)
        with app.db() as c:c.execute("UPDATE campaigns SET status='active' WHERE id=1")
        tag=next(row for row in contact_tags.state(app.db) if row['name']=='Retail')
        contact_tags.manage(app.db,{'action':'delete','id':tag['id']})
        with app.db() as c:
            self.assertEqual(c.execute('SELECT tags FROM contacts WHERE id=1').fetchone()[0],'[]')
            campaign=c.execute('SELECT * FROM campaigns WHERE id=1').fetchone()
            self.assertEqual(campaign['status'],'paused');self.assertEqual(campaign['audience_tags'],'[]')
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='queued'").fetchone()[0],0)
        self.assertFalse(contact_tags.matches(['Retail'],[]))
        app.init();self.assertNotIn('Retail',contact_tags.names(app.db))
        with self.assertRaises(ValueError):contact_tags.manage(app.db,{'action':'delete','id':tag['id']})

    def test_bulk_tags_are_additive_atomic_and_preserve_delivery_status(self):
        with app.db() as c:
            contact_tags.set_tags(c,1,'ERP')
            app.add_contact(c,{'email':'bulk@example.com','tags':'Polska'})
            second=c.execute("SELECT id FROM contacts WHERE email='bulk@example.com'").fetchone()[0]
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=?",(second,))
        result=contact_tags.bulk_assign(app.db,{'ids':[1,second,1],'tags':'VIP; erp'})
        self.assertEqual(result['updated'],2)
        with app.db() as c:
            first=c.execute('SELECT tags FROM contacts WHERE id=1').fetchone()
            row=c.execute('SELECT tags,status FROM contacts WHERE id=?',(second,)).fetchone()
            self.assertEqual(json.loads(first['tags']),['ERP','VIP'])
            self.assertEqual(json.loads(row['tags']),['Polska','VIP','ERP']);self.assertEqual(row['status'],'unsubscribed')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
        for data in ({'ids':[]},{'ids':[True]},{'ids':[1,-1]},{'ids':[1,9999]},{'ids':[1],'tags':[]}):
            with self.subTest(data=data),self.assertRaises(ValueError):contact_tags.bulk_assign(app.db,{'tags':['Not saved'],**data})
        self.assertNotIn('Not saved',contact_tags.names(app.db))
        with app.db() as c:contact_tags.set_tags(c,second,[str(i) for i in range(30)])
        with self.assertRaises(ValueError):contact_tags.bulk_assign(app.db,{'ids':[1,second],'tags':'Overflow'})
        with app.db() as c:self.assertNotIn('Overflow',json.loads(c.execute('SELECT tags FROM contacts WHERE id=1').fetchone()[0]))
