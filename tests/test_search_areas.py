import json
import unittest
from unittest.mock import patch

import app
import search_areas
import shared_project
import test_app
import test_prospecting


class SearchAreaTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown
    setup_run=test_prospecting.ProspectingTests.setup_run
    provider=test_prospecting.ProspectingTests.provider

    def area(self,**extra):return {'lat':52.2297,'lng':21.0122,'radius_km':50,'label':'Warsaw',**extra}

    def test_validated_areas_persist_per_project_without_changing_description(self):
        first=shared_project.save(app.db,{'audience':'My audience','search_areas':[self.area(),self.area()]})
        self.assertEqual(first['search_areas'],[self.area()])
        shared_project.create(app.db,{'name':'Other'})
        self.assertEqual(shared_project.get(app.db)['search_areas'],[])
        self.assertEqual(shared_project.get(app.db,first['id'])['audience'],'My audience')
        self.assertEqual(shared_project.resolve(app.db,{'project_id':first['id']})['search_areas'],[self.area()])
        shared_project.save(app.db,{'project_id':first['id'],'search_areas':[]})
        self.assertEqual(shared_project.get(app.db,first['id'])['search_areas'],[])

    def test_invalid_and_nonfinite_coordinates_are_rejected(self):
        for value in ('[]',{},[{}],[self.area(lat=True)],[self.area(lat=91)],[self.area(lng=-181)],
                      [self.area(lat=float('nan'))],[self.area(radius_km=float('inf'))],[self.area(radius_km=0)],
                      [self.area(radius_km=1001)],[self.area(label='x'*101)],[self.area()]*11):
            with self.subTest(value=type(value).__name__),self.assertRaises(ValueError):search_areas.validate(value)

    def test_search_snapshots_areas_in_query_and_does_not_claim_verified_radius(self):
        run_id=self.setup_run(search_areas=[self.area()])
        shared_project.save(app.db,{'search_areas':[self.area(lat=0,lng=0)]})
        self.assertEqual(json.loads(self.manager.get_run(run_id)['search_areas']),[self.area()])
        queries=[]
        def provider(endpoint,params=None,body=None):
            if endpoint=='discover':queries.append(body['query'])
            return self.provider(endpoint,params,body)
        with patch.dict('os.environ',{'HUNTER_API_KEY':'fixture-key'}),patch('prospecting.Hunter.request',side_effect=provider),patch.object(app.library,'page',return_value={'url':'https://buyer.example/','summary':'Retail shops'}),patch('ai_service.ready',return_value=True),patch('ai_service.generate_json',return_value={'qualification':'matched','fit_reason':'Possible fit','missing_data':'None'}):
            self.manager.search(run_id)
        self.assertIn('latitude 52.2297, longitude 21.0122, radius 50 km',queries[0])
        self.assertIn('union, not intersection',queries[0])
        with app.db() as c:
            candidate=c.execute('SELECT * FROM prospect_candidates WHERE run_id=?',(run_id,)).fetchone()
        self.assertEqual(candidate['qualification'],'uncertain')
        self.assertIn('Lokalizacja',candidate['missing_data'])
        self.assertTrue(json.loads(self.manager.get_run(run_id)['warnings']))
