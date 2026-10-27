import unittest

import app
import contact_groups
import test_app


class ContactGroupTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_add_contacts_optional_group_and_reuse_unicode_names(self):
        with app.db() as c:
            app.add_contact(c,{'email':'first@example.com','target_group':'  Łódź  '})
            app.add_contact(c,{'email':'second@example.com','target_group':'ŁÓDŹ'})
            app.add_contact(c,{'email':'third@example.com'})
        self.assertEqual(contact_groups.names(app.db),['Łódź'])
        with app.db() as c:
            groups=dict(c.execute('SELECT email,target_group FROM contacts'))
        self.assertEqual(groups['first@example.com'],'Łódź')
        self.assertEqual(groups['second@example.com'],'Łódź')
        self.assertEqual(groups['third@example.com'],'')
        app.init()
        self.assertEqual(contact_groups.names(app.db),['Łódź'])

    def test_assignment_does_not_change_status_or_messages_and_can_be_cleared(self):
        with app.db() as c:c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=1")
        contact_groups.assign(app.db,{'id':1,'target_group':'Manufacturers'})
        with app.db() as c:
            contact=c.execute('SELECT * FROM contacts WHERE id=1').fetchone()
            self.assertEqual(contact['target_group'],'Manufacturers')
            self.assertEqual(contact['status'],'unsubscribed')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
        contact_groups.assign(app.db,{'id':1,'target_group':''})
        self.assertEqual(contact_groups.names(app.db),[])
        with self.assertRaises(ValueError):contact_groups.assign(app.db,{'id':9999,'target_group':'Missing'})

    def test_bad_groups_are_atomic_and_duplicate_import_does_not_reassign(self):
        for value in (None,[],{},'x'*101,'New\nGroup'):
            with self.subTest(value=type(value).__name__),self.assertRaises(ValueError):
                with app.db() as c:app.add_contact(c,{'email':'bad@example.com','target_group':value})
        with app.db() as c:
            app.add_contact(c,{'email':'first@example.com','target_group':'First'})
            app.add_contact(c,{'email':'FIRST@example.com','target_group':'Other'})
            self.assertIsNone(c.execute("SELECT 1 FROM contacts WHERE email='bad@example.com'").fetchone())
        self.assertEqual(contact_groups.names(app.db),['First'])

    def test_campaign_group_uses_current_active_members_and_never_falls_back_to_all(self):
        with app.db() as c:
            c.execute("UPDATE contacts SET target_group='Retail' WHERE id=1")
            app.add_contact(c,{'email':'other@example.com','target_group':'Other'})
            app.add_contact(c,{'email':'paused@example.com','target_group':'Retail'})
            c.execute("UPDATE contacts SET status='paused' WHERE email='paused@example.com'")
            self.assertEqual(contact_groups.campaign_group(c,{'audience_mode':'group','target_group':' retail '}),'Retail')
            for value in ('','Missing',None):
                with self.assertRaises(ValueError):contact_groups.campaign_group(c,{'audience_mode':'group','target_group':value})
            c.execute("UPDATE campaigns SET audience_mode='group',target_group='Retail' WHERE id=1")
        app.prepare(1)
        with app.db() as c:
            self.assertEqual({row[0] for row in c.execute('SELECT contact_id FROM messages')},{1})
            c.execute("UPDATE contacts SET target_group='Other' WHERE id=1")
            app.add_contact(c,{'email':'new@example.com','target_group':'Retail'})
            new_id=c.execute("SELECT id FROM contacts WHERE email='new@example.com'").fetchone()[0]
        app.prepare(1)
        with app.db() as c:
            self.assertEqual({row[0] for row in c.execute('SELECT contact_id FROM messages')},{new_id})
            c.execute("UPDATE contacts SET target_group='Other' WHERE id=?",(new_id,))
        with self.assertRaises(ValueError):app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='sent'").fetchone()[0],0)
