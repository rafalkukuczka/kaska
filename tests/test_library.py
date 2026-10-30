import json
import time
import unittest
from unittest.mock import patch
import test_app
import app
import content_library as cl


class LibraryTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def store(self,website='https://alpha.example/',url='https://alpha.example/blog/delivery',title='Delivery workflows',summary='Shipping and logistics workflows for growing retailers',tags=None):
        with app.db() as c:
            app.library.store(c,website,dict(url=url,title=title,summary=summary,tags=tags or ['logistics','delivery'],kind='article'))
            return c.execute('SELECT id FROM materials WHERE url=?',(url,)).fetchone()[0]

    def campaign(self,**kwargs):
        result=dict(name='Generic',offer='A useful service',audience='Retail logistics',website='https://alpha.example/',material_mode='auto',material_ids='[]',language='en')
        result.update(kwargs);return result

    def test_no_default_customer_industry_or_materials(self):
        self.assertEqual(app.library.state(),{'projects':[],'materials':[]})

    def test_discovery_for_unrelated_industries_and_upsert(self):
        pages={
            'https://baker.example':('<html><title>Better Bread</title><meta name="description" content="Fresh bakery products for local cafes and restaurants"><body><h1>Better bread for restaurants and neighborhood cafes</h1><a href="/products">Our bread products</a><a href="https://other.example/products">External</a><a href="/contact">Contact</a></body></html>','https://baker.example/'),
            'https://baker.example/products':('<html><title>Sourdough for cafes</title><body>Freshly baked sourdough products for cafes and restaurants with local delivery every morning.</body></html>','https://baker.example/products')}
        with patch('content_library.fetch_public',side_effect=lambda u:pages[u]):
            result=app.library.discover('https://baker.example')
            self.assertEqual(result['added'],2)
            app.library.discover('https://baker.example')
        state=app.library.state()
        self.assertEqual(len(state['materials']),2)
        self.assertEqual(state['projects'][0]['website'],'https://baker.example/')
        self.assertIn('bakery',state['projects'][0]['offer'])
        self.assertNotIn('rabbitmq',json.dumps(state).lower())

    def test_auto_selection_is_scoped_to_sender_domain(self):
        material_id=self.store()
        self.store(website='https://beta.example/',url='https://beta.example/logistics',title='Retail logistics',summary='Retail logistics shipping delivery')
        selected=app.library.select({'notes':'logistics shipping delivery'},self.campaign())
        self.assertEqual(selected['id'],material_id)
        self.assertIsNone(app.library.select({'notes':'dental orthodontics'},self.campaign(audience='')))

    def test_manual_selection_and_disabled_material(self):
        material_id=self.store()
        campaign=self.campaign(material_mode='manual',material_ids=json.dumps([material_id]))
        self.assertEqual(app.library.select({},campaign)['id'],material_id)
        app.library.post('status',{'id':material_id,'enabled':False})
        self.assertIsNone(app.library.select({},campaign))

    def test_generated_message_contains_real_material_and_cta_once(self):
        material_id=self.store()
        campaign=self.campaign(material_mode='manual',material_ids=json.dumps([material_id]),cta='Book a call',cta_url='https://alpha.example/contact')
        subject,body=app.ai_copy({'name':'Alex','company':'Store'},campaign,{'subject':'For {{company}}','body':'Hi {{name}}, {{offer}}'})
        self.assertEqual(subject,'For Store')
        self.assertEqual(body.count('https://alpha.example/blog/delivery'),1)
        self.assertEqual(body.count('https://alpha.example/contact'),1)
        _,body=app.ai_copy({'name':'Alex','company':'Store'},campaign,{'subject':'Hi','body':'{{material_url}}\n{{cta_url}}'})
        self.assertEqual(body.count('https://alpha.example/blog/delivery'),1)

    def test_contact_notes_change_material_choice(self):
        self.store()
        cloud=self.store(url='https://alpha.example/cloud',title='Cloud migration',summary='Cloud hosting migration infrastructure',tags=['cloud','migration'])
        selected=app.library.select({'notes':'Company announced cloud migration'},self.campaign(audience=''))
        self.assertEqual(selected['id'],cloud)

    def test_cross_company_material_and_invalid_campaign_rejected(self):
        mid=self.store()
        with app.db() as c:
            with self.assertRaises(ValueError):app.library.validate_campaign(c,{'website':'https://beta.example','material_mode':'manual','material_ids':[mid]})
            with self.assertRaises(ValueError):app.library.validate_campaign(c,{'audience_mode':'selected','contact_ids':[]})
            with self.assertRaises(ValueError):app.library.validate_campaign(c,{'cta_url':'javascript:alert(1)'})

    def test_selected_recipients_are_not_replaced_by_whole_database(self):
        with app.db() as c:
            app.add_contact(c,{'email':'other@example.com'})
            c.execute("UPDATE campaigns SET audience_mode='selected',contact_ids='[1]' WHERE id=1")
        app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT COUNT(DISTINCT contact_id) FROM messages').fetchone()[0],1)
            c.execute("UPDATE campaigns SET audience_mode='signals' WHERE id=1")
        with self.assertRaises(ValueError):app.prepare(1)

    def test_idempotent_migration_preserves_data(self):
        self.store();app.init();app.init()
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM materials').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT audience_mode FROM campaigns').fetchone()[0],'all')

    def test_material_cannot_redirect_to_other_customer_domain(self):
        with patch('content_library.fetch_public',return_value=('<html><title>Other</title><body>'+('Other customer confidential info '*4)+'</body></html>','https://other.example/info')):
            with self.assertRaises(ValueError):app.library.add({'website':'https://alpha.example','url':'https://alpha.example/info'})


if __name__=='__main__':unittest.main()
