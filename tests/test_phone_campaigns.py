import unittest
from unittest.mock import patch

import app
import phone_campaigns
import shared_project
import test_app


class PhoneCampaignTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_time_variant_round_trips_and_clones_with_the_step(self):
        options={'name':'Calls','audience_mode':'all','scripts':['Dzień dobry.'],
                 'time_variants':[{'start':'06:00','end':'18:00','otherwise':'Dobry wieczór.'}]}
        with app.db() as c:
            campaign_id=phone_campaigns.save(c,options)['id']
            data=phone_campaigns.read(c,campaign_id)
            self.assertEqual(data['time_variants'],options['time_variants'])
            with self.assertRaises(ValueError):
                phone_campaigns.save(c,{**options,'time_variants':[{'start':'09:00','end':'09:00','otherwise':'Cześć'}]})
        cloned=app.campaign_edit.clone(app.db,{'id':campaign_id})['campaign']['id']
        with app.db() as c:
            self.assertEqual(phone_campaigns.read(c,cloned)['time_variants'],options['time_variants'])

    def test_updating_the_whatsapp_number_keeps_other_contact_data(self):
        with app.db() as c:
            app.add_contact(c,{'email':'local@example.com','phone':'609 02 57 57','website':'https://example.com'})
            row=c.execute("SELECT id FROM contacts WHERE email='local@example.com'").fetchone()
            payload={'id':row['id'],'project_id':1,'expected_phone':'609 02 57 57','phone':'+48609025757'}
            app.update_contact_phone(c,payload)
            with self.assertRaises(ValueError):
                app.update_contact_phone(c,{**payload,'phone':'+48609025758'})
            details=c.execute('SELECT research_data FROM contacts WHERE id=?',(row['id'],)).fetchone()[0]
            self.assertIn('+48609025757',details)
            self.assertIn('example.com',details)

    def test_positioned_condition_blocks_the_follow_up(self):
        with app.db() as c:
            app.add_contact(c,{'email':'phone@example.com','phone':'123456789','company':'Other'})
            contact_id=c.execute("SELECT id FROM contacts WHERE email='phone@example.com'").fetchone()[0]
            condition={'field':'company','operator':'equals','value':'Qualified','before_step':1}
            campaign_id=phone_campaigns.save(c,{'name':'Calls','audience_mode':'all','scripts':['Intro','Follow-up'],
                                               'conditions':[condition]})['id']
            data=phone_campaigns.read(c,campaign_id)
            self.assertEqual(data['conditions'],[condition])
            self.assertEqual([person['position'] for person in data['queue']],[0])
            phone_campaigns.record(c,{'id':campaign_id,'contact_id':contact_id,'position':0,'outcome':'no_answer'})
            self.assertEqual(phone_campaigns.read(c,campaign_id)['queue'],[])
            with self.assertRaises(ValueError):
                phone_campaigns.record(c,{'id':campaign_id,'contact_id':contact_id,'position':1,'outcome':'answered'})

    def test_ai_refines_a_call_script_in_its_original_language(self):
        with patch('app.ai_service.ready',return_value=True),patch('app.ai_service.generate_json',
                return_value={'text':' Dzień dobry. Czy ma Pan chwilę? '}) as generate:
            result=app.refine_text({'field':'script','text':'Dzien dobry. Czy ma pan chwile?'})
        self.assertEqual(result,{'text':'Dzień dobry. Czy ma Pan chwilę?'})
        prompt,payload,fields=generate.call_args.args
        self.assertIn('Zachowaj język tekstu wejściowego',prompt)
        self.assertIn('skrypt rozmowy telefonicznej',prompt)
        self.assertEqual((payload['field'],fields),('script',('text',)))

    def test_audience_uses_current_valid_phone_and_selected_tags(self):
        with app.db() as c:
            app.add_contact(c, {'email':'tagged@example.com','phone':'+48 123 456 789','tags':['Sales','Poland']})
            app.add_contact(c, {'email':'other@example.com','phone':'123456789','tags':['Sales']})
            app.add_contact(c, {'email':'no-phone@example.com','tags':['Sales','Poland']})
            app.add_contact(c, {'email':'paused@example.com','phone':'123456789','tags':['Sales','Poland']})
            c.execute("UPDATE contacts SET status='paused' WHERE email='paused@example.com'")
            tagged = c.execute("SELECT id FROM contacts WHERE email='tagged@example.com'").fetchone()[0]
            other = c.execute("SELECT id FROM contacts WHERE email='other@example.com'").fetchone()[0]
            options = {'name':'Calls','audience_mode':'tags','audience_tags':['Sales','Poland'],
                       'tag_match':'all','scripts':['Introduction']}
            campaign_id = phone_campaigns.save(c,options)['id']
            queue = phone_campaigns.read(c,campaign_id)['queue']
            self.assertEqual([(person['id'],person['dial']) for person in queue], [(tagged,'+48123456789')])
            preview = phone_campaigns.preview_recipients(c,{**options,'id':campaign_id})
            self.assertEqual([person['id'] for person in preview['recipients']],[tagged])
            phone_campaigns.save(c,{**options,'id':campaign_id,'audience_mode':'all'})
            self.assertEqual({person['id'] for person in phone_campaigns.read(c,campaign_id)['queue']},{tagged,other})
        shared_project.create(app.db,{'name':'Another project','share_contacts':True})
        with app.db() as c,self.assertRaises(ValueError):
            phone_campaigns.read(c,campaign_id)

    def test_call_outcomes_advance_only_the_eligible_contact(self):
        with app.db() as c:
            app.add_contact(c,{'email':'phone@example.com','phone':'123456789'})
            contact_id = c.execute("SELECT id FROM contacts WHERE email='phone@example.com'").fetchone()[0]
            settings = {'name':'Calls','audience_mode':'all','scripts':['Introduction','Follow-up']}
            campaign_id = phone_campaigns.save(c,settings)['id']
            item = {'id':campaign_id,'contact_id':contact_id,'position':0,'outcome':'no_answer'}
            with self.assertRaises(ValueError):
                phone_campaigns.record(c,{**item,'contact_id':1})
            with self.assertRaises(ValueError):
                phone_campaigns.record(c,{**item,'position':1})
            phone_campaigns.record(c,item)
            phone_campaigns.record(c,item)
            data = phone_campaigns.read(c,campaign_id)
            self.assertEqual([person['position'] for person in data['queue']],[1])
            self.assertEqual(len(data['calls']),1)
            with self.assertRaises(ValueError):
                phone_campaigns.save(c,{**settings,'id':campaign_id,'scripts':['Edited']})
            phone_campaigns.record(c,{**item,'position':1,'outcome':'answered'})
            self.assertEqual(phone_campaigns.read(c,campaign_id)['queue'],[])
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],0)
