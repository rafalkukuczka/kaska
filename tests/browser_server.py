"""Isolated browser-test server with deterministic public-website fixtures."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import content_library
import prospecting
import ai_service
from unittest.mock import patch
import json
import time
from datetime import datetime, timezone

PAGES={
 'https://acme.example/':'<title>Acme</title><main>Acme builds industrial products and operates several manufacturing plants in Europe.</main>',
 'https://buyer.example/': '<title>Buyer Retail</title><meta name="description" content="Buyer Retail operates online shops in Poland"><main>Buyer Retail helps customers buy everyday products through its ecommerce stores in Poland.</main>',
 'https://alpha.example/': '<title>Alpha — delivery services</title><meta name="description" content="Delivery and logistics services for retail teams"><main>Alpha helps retail teams simplify shipping, delivery and logistics workflows.<a href="/articles/delivery">Delivery guide</a></main>',
 'https://alpha.example/articles/delivery': '<title>A practical delivery guide</title><meta name="description" content="A guide to shipping and delivery workflows"><main>Practical recommendations for retail teams managing delivery operations and shipping workflows.</main>',
 'https://bakery.example/': '<title>Everyday Bakery</title><meta name="description" content="Fresh bread for neighborhood cafes"><main>Everyday Bakery offers fresh bread and pastries for cafes and restaurants.<a href="/products/bread">Our bread products</a></main>',
 'https://bakery.example/products/bread': '<title>Sourdough for cafes</title><main>Freshly baked sourdough bread for neighborhood cafes and restaurants with local delivery.</main>',
}

def fetch_fixture(url):
    if url.startswith('https://news.example/opportunity-'):
        key=url.rsplit('/',1)[-1].removeprefix('opportunity-')
        day=datetime.now(timezone.utc).date().isoformat()
        return '<main>Acme announced '+key+' on '+day+'. The announcement describes a concrete business event. <a href="https://acme.example/">Acme</a></main>',url
    key=url.rstrip('/')+'/' if url.rstrip('/') in ('https://alpha.example','https://bakery.example') else url
    if key not in PAGES:raise ValueError('No test fixture for this website')
    return PAGES[key],key

if __name__=='__main__':
    original_generate=ai_service.generate_json
    def opportunity_fixture(instructions,data,fields,**kwargs):
        if app.os.environ.get('OPENAI_API_KEY')!='browser-opportunity-fixture-only':return original_generate(instructions,data,fields,**kwargs)
        if fields!=('opportunities',) or not kwargs.get('web_search'):raise ValueError('Unexpected fixture AI operation')
        time.sleep(.7)
        key=data['selected_types'][0]['key'];day=datetime.now(timezone.utc).date().isoformat()
        url='https://news.example/opportunity-'+key
        return {'data':{'opportunities':json.dumps([{'kind':key,'company':'Acme','title':'Acme '+key,
            'summary':'Acme announced '+key+'.','source_url':url,'quote':'Acme announced '+key+' on '+day+'.',
            'event_date':day,'date_quote':day,'published_date':day,'published_quote':day,'relevance':80,
            'reason':'A potential fit for the project offering, requiring review.','website':'https://acme.example/',
            'location':'Berlin','duplicate_id':None}])},'sources':[url,'https://acme.example/']}
    ai_service.generate_json=opportunity_fixture
    def hunter_fixture(self, endpoint, params=None, body=None):
        if self.key != 'browser-fixture-only':
            raise ValueError('Browser fixture requires its isolated test key')
        if endpoint == 'discover':
            return {'data': [{'domain': 'buyer.example', 'organization': 'Buyer Retail'}], 'meta': {'filters': {'headquarters_location': {'include': [{'country': 'PL'}]}}}}
        if endpoint == 'domain-search':
            domain=(params or {}).get('domain') or 'buyer.example'
            return {'data': {'domain':domain,'organization':'Acme' if domain=='acme.example' else 'Buyer Retail','emails': [
                {'value': name.lower()+'@'+domain, 'first_name': name, 'last_name': 'Test', 'position': 'COO', 'type': 'personal', 'provenance': 'found', 'sources': [{'uri': 'https://'+domain+'/team', 'last_seen_on': '2026-10-26'}]}
                for name in ('Anna', 'Bob')]}}
        if endpoint == 'email-verifier':
            return {'data': {'status': 'valid' if params['email'].startswith('anna') else 'accept_all', 'accept_all': not params['email'].startswith('anna'), 'verification': {'date': datetime.now(timezone.utc).strftime('%Y-%m-%d')}}}
        return {'data': {}}
    prospecting.Hunter.request=hunter_fixture
    def apollo_fixture(self,endpoint,body=None):
        if self.key!='browser-apollo-only':raise ValueError('Apollo browser fixture requires its isolated test key')
        if endpoint=='auth/health':return {'healthy':True,'is_logged_in':True}
        if endpoint=='mixed_people/api_search':return {'people':[{'id':'charlie-fixture'}]}
        if endpoint=='people/match':return {'person':{'first_name':'Charlie','last_name':'Test','title':'COO',
            'email':'charlie@buyer.example','email_status':'verified','organization':{'primary_domain':'buyer.example'}}}
        raise ValueError('Unknown Apollo fixture operation')
    prospecting.contact_enrichment.Apollo.request=apollo_fixture
    content_library.fetch_public=fetch_fixture
    app.init()
    print(f'Katie: http://localhost:{app.PORT}',flush=True)
    app.ThreadingHTTPServer(('127.0.0.1',app.PORT),app.Handler).serve_forever()
