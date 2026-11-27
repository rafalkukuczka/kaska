import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import app
import phone_campaigns
import shared_project
import test_app


class PhoneCampaignTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_call_time_condition_routes_to_independent_scripts(self):
        with app.db() as c:
            app.add_contact(c, {'email':'hours@example.com','phone':'123456789'})
            hours={'field':'call_time','start':'06:00','end':'18:00'}
            flow={'entry':'time','nodes':[
                {'id':'time','kind':'condition','rules':[hours],'yes':'day','no':'evening'},
                {'id':'day','kind':'script','text':'Dzień dobry.'},
                {'id':'evening','kind':'script','text':'Dobry wieczór.'},
            ]}
            options={'name':'Calls','audience_mode':'all','flow':flow}
            campaign_id=phone_campaigns.save(c,options)['id']
            for month, utc_hour, expected in [(1,5,'Dzień dobry.'),(1,17,'Dobry wieczór.'),
                                               (7,4,'Dzień dobry.'),(7,16,'Dobry wieczór.')]:
                now=datetime(2026,month,15,utc_hour,tzinfo=timezone.utc).timestamp()
                with patch('phone_campaigns.time.time',return_value=now):
                    result=phone_campaigns.read(c,campaign_id)
                    self.assertEqual(result['queue'][0]['script'],expected)
                    self.assertEqual(result['flow']['nodes'][0]['rules'],[hours])
            hours.update(start='20:00',end='04:00')
            phone_campaigns.save(c,{**options,'id':campaign_id})
            with patch('phone_campaigns.time.time',return_value=datetime(2026,7,15,23,tzinfo=timezone.utc).timestamp()):
                self.assertEqual(phone_campaigns.read(c,campaign_id)['queue'][0]['script'],'Dzień dobry.')
            hours['end']='20:00'
            with self.assertRaisesRegex(ValueError,'dwie różne godziny'):
                phone_campaigns.save(c,{**options,'id':campaign_id})

    def test_moving_blocks_preserves_the_sequence_version_and_edges(self):
        with app.db() as c:
            app.add_contact(c,{'email':'layout@example.com','phone':'123456789'})
            flow={'entry':'first','nodes':[{'id':'first','kind':'script','text':'Intro','answered':'second'},
                                        {'id':'second','kind':'script','text':'Follow-up'}]}
            options={'name':'Calls','audience_mode':'all','flow':flow}
            campaign_id=phone_campaigns.save(c,options)['id']
            before=phone_campaigns.read(c,campaign_id)['queue'][0]
            layout={'first':[125,160],'second':[10,220]}
            phone_campaigns.save(c,{**options,'id':campaign_id,'flow':{**flow,'layout':layout}})
            latest=phone_campaigns.read(c,campaign_id)
            self.assertEqual(latest['flow']['layout'],layout)
            self.assertEqual(latest['flow']['nodes'][0]['answered'],'second')
            self.assertEqual(latest['queue'][0]['flow_id'],before['flow_id'])
            with self.assertRaises(ValueError):
                phone_campaigns.save(c,{**options,'id':campaign_id,'flow':{**flow,'layout':{'first':[-1,20]}}})

    def test_offer_fields_and_draft_documents_are_saved_for_both_sequence_types(self):
        draft='734870a9-faa3-4c92-93e3-7dcec1544e7b'
        options={'name':'Calls','audience_mode':'all','offer':'Usługa','audience':'Kierownicy',
                 'website':'example.com','language':'en','cta':'Umów rozmowę','cta_url':'https://example.com/demo',
                 'value_props':'Oszczędność czasu','offer_sources':['campaign_documents'],'offer_draft_key':draft}
        with app.db() as c:
            c.execute("""INSERT INTO campaign_offer_documents(project_id,scope,name,digest,text)
                      VALUES(1,?,'Offer.txt','fixture','Offer content')""",('draft:'+draft,))
            campaign_id=phone_campaigns.save(c,{**options,'scripts':['Intro']})['id']
            row=c.execute('SELECT * FROM campaigns WHERE id=?',(campaign_id,)).fetchone()
            self.assertEqual((row['offer'],row['website'],row['language'],row['cta']),
                             ('Usługa','https://example.com','en','Umów rozmowę'))
            self.assertEqual(c.execute('SELECT scope FROM campaign_offer_documents').fetchone()[0],f'campaign:{campaign_id}')
            phone_campaigns.save(c,{'id':campaign_id,'name':'Calls','audience_mode':'all','offer':'Nowa oferta',
                'flow':{'entry':'intro','nodes':[{'id':'intro','kind':'script','text':'Intro'}]}})
            updated=c.execute('SELECT offer,audience,cta_url FROM campaigns WHERE id=?',(campaign_id,)).fetchone()
            self.assertEqual(tuple(updated),('Nowa oferta','Kierownicy','https://example.com/demo'))

    def test_branches_run_both_paths_and_keep_started_contacts_on_their_version(self):
        flow={'entry':'test','nodes':[
            {'id':'test','kind':'condition','rules':[{'field':'company','operator':'equals','value':'Alpha'}],
             'yes':'yes','no':'no'},
            {'id':'yes','kind':'script','text':'Yes branch','answered':'common'},
            {'id':'no','kind':'script','text':'No branch','no_answer':'common'},
            {'id':'common','kind':'script','text':'Common follow-up'},
        ]}
        with app.db() as c:
            app.add_contact(c,{'name':'Alpha recipient','email':'alpha@example.com','phone':'123456789','company':'Alpha'})
            app.add_contact(c,{'name':'Beta recipient','email':'beta@example.com','phone':'123456789','company':'Beta'})
            options={'name':'Branches','audience_mode':'all','flow':flow}
            campaign_id=phone_campaigns.save(c,options)['id']
            first,second=phone_campaigns.read(c,campaign_id)['queue']
            self.assertEqual([first['script'],second['script']],['Yes branch','No branch'])
            for step,outcome in [(first,'answered'),(second,'no_answer')]:
                phone_campaigns.record(c,{'id':campaign_id,'contact_id':step['id'],'position':step['position'],
                                          'flow_id':step['flow_id'],'outcome':outcome})
            new_flow={'entry':'new','nodes':[{'id':'new','kind':'script','text':'New sequence'}]}
            phone_campaigns.save(c,{**options,'id':campaign_id,'flow':new_flow})
            app.add_contact(c,{'name':'Later recipient','email':'later@example.com','phone':'987654321'})
            queue=phone_campaigns.read(c,campaign_id)['queue']
            self.assertEqual([step['script'] for step in queue],['Common follow-up','Common follow-up','New sequence'])
            self.assertNotEqual(queue[0]['flow_id'],queue[-1]['flow_id'])
            with self.assertRaisesRegex(ValueError,'pętlę'):
                phone_campaigns.save(c,{**options,'id':campaign_id,'flow':{'entry':'loop','nodes':[
                    {'id':'loop','kind':'script','text':'Loop','answered':'loop'}]}})

    def test_conversion_keeps_prior_linear_progress(self):
        with app.db() as c:
            app.add_contact(c,{'email':'legacy@example.com','phone':'123456789'})
            options={'name':'Calls','audience_mode':'all','scripts':['Intro','Follow-up']}
            campaign_id=phone_campaigns.save(c,options)['id']
            person=phone_campaigns.read(c,campaign_id)['queue'][0]
            phone_campaigns.record(c,{'id':campaign_id,'contact_id':person['id'],'position':0,'outcome':'no_answer'})
            phone_campaigns.save(c,{**options,'id':campaign_id,'flow':{'entry':'new','nodes':[
                {'id':'new','kind':'script','text':'New flow'}]}})
            progress=phone_campaigns.read(c,campaign_id)
            self.assertEqual(progress['queue'][0]['script'],'Follow-up')
            self.assertEqual(progress['calls'][0]['flow_id'],progress['queue'][0]['flow_id'])

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
