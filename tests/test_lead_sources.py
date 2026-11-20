import json
import unittest
from datetime import date
from unittest.mock import patch

import app
import lead_sources
import test_app


class LeadSourcesTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_company_publication_is_downloaded_once_for_different_checks(self):
        url = 'https://example.com/company'
        html = '<h1>Acme</h1><p>' + 'Public company event and evidence. ' * 6 + '</p>'
        cache = lead_sources.SourceCache(app.db)
        with patch('public_data.fetch_public',return_value=(html,url)) as fetch:
            self.assertEqual(cache.fetch(1,url),(html,url))
            self.assertIn('Public company event',cache.publication(1,url,{})['body'])
            cache.publication(1,url,{})
        fetch.assert_called_once_with(url)

    def test_personio_active_jobs_and_register_number_are_attached_to_the_company(self):
        url = 'https://acme.jobs.personio.de/xml'
        html = '<a href="https://acme.jobs.personio.de/">Offene Stellen</a>'
        source = '<workzag-jobs><position><id>15</id><name>C# Entwickler SCADA</name><createdAt>2026-11-10T09:00:00</createdAt></position></workzag-jobs>'
        pages = [{'url':'https://example.com/impressum','official':True,'text':'Amtsgericht Berlin HRB 123456',
                  'ats':lead_sources.discover_ats_links(html,'https://example.com/')}]
        profile = lead_sources.company_profile(pages,lambda _: (source,url))
        self.assertEqual(profile['identity']['number'],'HRB 123456')
        self.assertEqual(profile['active_jobs'],1)
        self.assertEqual(profile['jobs'][0]['url'],'https://acme.jobs.personio.de/job/15')
        self.assertEqual(lead_sources.job_signals(profile,'it_hiring')[0]['date_kind'],'active')
        self.assertIn('Head of Automation', lead_sources.contact_roles(profile,[]))
        self.assertFalse(lead_sources.discover_ats_links('<a href="https://acme.jobs.personio.de.evil.example/">Jobs</a>',
                                                       'https://example.com/'))

    def test_greenhouse_excludes_prospect_forms_and_keeps_active_erp_job(self):
        endpoint = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true'
        body = {'jobs':[{'internal_job_id':None,'title':'General application','absolute_url':'https://example.com/form'},
                        {'internal_job_id':12,'title':'ERP engineer','absolute_url':'https://example.com/jobs/12',
                         'content':'&lt;p&gt;SAP S/4HANA migration&lt;/p&gt;','updated_at':'2026-11-16T08:00:00Z'}]}
        items = lead_sources.job_posts('Greenhouse',endpoint,lambda _:(json.dumps(body),endpoint))
        self.assertEqual(len(items),1)
        self.assertEqual(items[0]['technology'],['ERP / MES'])
        self.assertEqual(items[0]['published'],'')

    def test_ted_drops_other_buyers_and_award_notices(self):
        notice = {'buyer-name':['Acme GmbH'],'notice-title':{'deu':'Modernisierung des ERP-Systems'},
                  'publication-date':'20261115','publication-number':'123456-2026','notice-type':'cn-standard'}
        payload = {'notices':[notice,{**notice,'buyer-name':['Other GmbH']},{**notice,'notice-type':'can-standard'}]}
        events = lead_sources.parse_ted(payload,['Acme GmbH'],date(2026,11,17))
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]['source_date'],'2026-11-15')

    def test_first_party_signal_updates_coverage_and_is_deduplicated(self):
        with app.db() as c:
            c.execute("""UPDATE seller_projects SET data=json_set(data,'$.signal_interests',json('["demo_request"]'))
                         WHERE id=1""")
        search = app.lead_finder.create({'query':'Acme'})['search']['id']
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).date().isoformat()
        item = {'id':search,'domain':'example.com','kind':'demo_request','date':stamp,'detail':'Prośba o demo z CRM'}
        app.lead_finder.record_private(item)
        app.lead_finder.record_private(item)
        data = app.lead_finder.state(search)
        self.assertEqual(len(data['events']),1)
        self.assertEqual(data['companies'][0]['signal_checks'][0]['status'],'confirmed')
        self.assertEqual(data['companies'][0]['priority']['level'],'high')
