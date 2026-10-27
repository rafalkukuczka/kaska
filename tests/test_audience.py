import unittest
from unittest.mock import patch

import app
import shared_project
import test_app


class AudienceSuggestionTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_uses_offer_pains_and_values_without_saving_or_searching(self):
        original=shared_project.get(app.db)
        data={'offer':'Industrial automation','pain_points':'Manual reporting','value_props':'Less repetitive work',
              'audience':'Manufacturers in Germany, exclude retailers','search_languages':['de'],'language':'en'}
        with patch('ai_service.ready',return_value=True),patch('ai_service.generate_json',return_value={'audience':'Manufacturing companies with manual reporting processes.'}) as generate:
            result=app.suggest_audience(data)
        instruction,context,fields=generate.call_args.args
        self.assertEqual(context,{k:v for k,v in data.items() if k!='language'})
        self.assertEqual(fields,('audience',))
        self.assertIn('Preserve all explicit constraints',instruction)
        self.assertIn('English',instruction)
        self.assertFalse(generate.call_args.kwargs.get('web_search',False))
        self.assertTrue(result['audience'])
        self.assertEqual(shared_project.get(app.db),original)
        self.assertEqual(app.prospector.state()['runs'],[])

    def test_rejects_missing_offer_oversized_context_and_invalid_languages(self):
        with patch('ai_service.ready',return_value=True),patch('ai_service.generate_json') as generate:
            for item in ({},{'offer':' '},{'offer':[]},{'offer':'x'*10001},{'offer':'Services','pain_points':[]},
                         {'offer':'Services','audience':'x'*3001},{'offer':'Services','value_props':'x'*10001},
                         {'offer':'Services','language':'xx'},{'offer':'Services','search_languages':['xx']}):
                with self.subTest(item=list(item)),self.assertRaises(ValueError):app.suggest_audience(item)
            generate.assert_not_called()

    def test_missing_key_and_bad_output_do_not_change_project(self):
        original=shared_project.get(app.db)
        with patch('ai_service.ready',return_value=False),patch('ai_service.generate_json') as generate:
            with self.assertRaises(ValueError):app.suggest_audience({'offer':'Services'})
            generate.assert_not_called()
        for audience in ('','short',None,[], 'x'*3001):
            with self.subTest(audience=type(audience).__name__),patch('ai_service.ready',return_value=True),patch('ai_service.generate_json',return_value={'audience':audience}):
                with self.assertRaises(ValueError):app.suggest_audience({'offer':'Services'})
        self.assertEqual(shared_project.get(app.db),original)
