"""Isolated browser-test server with deterministic public-website fixtures."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import content_library
import sales_signals
import prospecting
import ai_service
from unittest.mock import patch
import json
import time
from datetime import datetime, timezone

PAGES={
 'https://buyer.example/': '<title>Buyer Retail</title><meta name="description" content="Buyer Retail operates online shops in Poland"><main>Buyer Retail helps customers buy everyday products through its ecommerce stores in Poland.</main>',
 'https://alpha.example/': '<title>Alpha — delivery services</title><meta name="description" content="Delivery and logistics services for retail teams"><main>Alpha helps retail teams simplify shipping, delivery and logistics workflows.<a href="/articles/delivery">Delivery guide</a></main>',
 'https://alpha.example/articles/delivery': '<title>A practical delivery guide</title><meta name="description" content="A guide to shipping and delivery workflows"><main>Practical recommendations for retail teams managing delivery operations and shipping workflows.</main>',
 'https://bakery.example/': '<title>Everyday Bakery</title><meta name="description" content="Fresh bread for neighborhood cafes"><main>Everyday Bakery offers fresh bread and pastries for cafes and restaurants.<a href="/products/bread">Our bread products</a></main>',
 'https://bakery.example/products/bread': '<title>Sourdough for cafes</title><main>Freshly baked sourdough bread for neighborhood cafes and restaurants with local delivery.</main>',
}

def fetch_fixture(url):
    key=url.rstrip('/')+'/' if url.rstrip('/') in ('https://alpha.example','https://bakery.example') else url
    if key not in PAGES:raise ValueError('No test fixture for this website')
    return PAGES[key],key

if __name__=='__main__':
    original_generate=ai_service.generate_json
    def discovery_fixture(instructions,data,fields,**kwargs):
        if fields==('plan',):
            return {'plan':json.dumps([
                {'topic':'ERP Monitoring QA','signal_kinds':['erp'],'reason':'An ERP project may need implementation support.'},
                {'topic':'Unselected QA','signal_kinds':['funding'],'reason':'A possible secondary topic.'}])}
        if fields==('companies',):
            return {'companies':json.dumps([{'company':'Acme','quote':'Acme announced an ERP implementation.',
                                            'reason':'Review the ERP project before discussing implementation services.'}])}
        if not kwargs.get('web_search'):return original_generate(instructions,data,fields,**kwargs)
        if data['company']=='Blocked Site QA':
            time.sleep(1.5)
            return {'data':{'website':'https://blocked.example/','career':'NONE','rss':'NONE','greenhouse':'NONE','lever':'NONE',
                'signal_kinds':'','identity':'matched','reason':'Company website is blocked; check news independently.'},'sources':['https://blocked.example/']}
        if data['company']!='Bulk Sources QA':raise ValueError('No discovery fixture for this company')
        time.sleep(10 if data.get('seller_offer')=='browser-cancel-fixture' else 1.5)
        return {'data':{'website':'https://bulk.example/','career':'https://bulk.example/careers','rss':'https://bulk.example/feed.xml',
            'greenhouse':'https://job-boards.greenhouse.io/acme','lever':'https://jobs.eu.lever.co/acme',
            'signal_kinds':'funding,it_hiring','identity':'matched','reason':'The official site matches the contact domain.'},'sources':['https://bulk.example/']}
    ai_service.generate_json=discovery_fixture
    original_discovery_start=app.source_finder.start
    def start_discovery_fixture(item):
        with patch('source_discovery.ai_service.ready',return_value=True):return original_discovery_start(item)
    app.source_finder.start=start_discovery_fixture
    def hunter_fixture(self, endpoint, params=None, body=None):
        if self.key != 'browser-fixture-only':
            raise ValueError('Browser fixture requires its isolated test key')
        if endpoint == 'discover':
            return {'data': [{'domain': 'buyer.example', 'organization': 'Buyer Retail'}], 'meta': {'filters': {'headquarters_location': {'include': [{'country': 'PL'}]}}}}
        if endpoint == 'domain-search':
            return {'data': {'domain':'buyer.example','organization':'Buyer Retail','emails': [
                {'value': name.lower()+'@buyer.example', 'first_name': name, 'last_name': 'Test', 'position': 'COO', 'type': 'personal', 'provenance': 'found', 'sources': [{'uri': 'https://buyer.example/team', 'last_seen_on': '2026-10-26'}]}
                for name in ('Anna', 'Bob')]}}
        if endpoint == 'email-verifier':
            return {'data': {'status': 'valid' if params['email'].startswith('anna') else 'accept_all', 'accept_all': not params['email'].startswith('anna'), 'verification': {'date': datetime.now(timezone.utc).strftime('%Y-%m-%d')}}}
        return {'data': {}}
    prospecting.Hunter.request=hunter_fixture
    content_library.fetch_public=fetch_fixture
    original_fetch=sales_signals.fetch_public
    def provider_fixture(url,**kwargs):
        if url.startswith('https://news.google.com/rss/search?') and 'ERP+Monitoring+QA' in url:
            return '<rss><channel><item><title>Acme ERP Monitoring QA ERP implementation</title><description>Acme announced an ERP implementation.</description><link>https://example.com/erp-monitoring-qa</link></item></channel></rss>',url
        if url=='https://blocked.example/':raise sales_signals.FetchError(403)
        if url=='https://bulk.example/':return '<title>Bulk Sources QA</title><main>Bulk Sources QA logistics</main><a href="/careers">Careers</a><link type="application/rss+xml" href="/feed.xml">',url
        if url=='https://bulk.example/careers':return '<main>Bulk Sources QA careers</main><a href="https://job-boards.greenhouse.io/acme">Jobs</a><a href="https://jobs.eu.lever.co/acme">Lever</a>',url
        if url=='https://bulk.example/feed.xml':return '<rss version="2.0"><channel><title>Bulk Sources QA news</title></channel></rss>',url
        if url.startswith('https://news.google.com/rss/search?'):return '<rss version="2.0"><channel><title>News</title></channel></rss>',url
        if url.startswith('https://api.gdeltproject.org/api/v2/doc/doc?'):return '{"articles":[]}',url
        if url.startswith('https://api.eu.lever.co/v0/postings/acme?'):return '[]',url
        if url=='https://boards-api.greenhouse.io/v1/boards/acme/jobs':
            return json.dumps({'jobs':[{'title':'Software Engineer','absolute_url':'https://example.com/jobs/engineer','first_published':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'location':{'name':'Remote'}}]}),url
        return original_fetch(url,**kwargs)
    sales_signals.fetch_public=provider_fixture
    app.init()
    print(f'Katie: http://localhost:{app.PORT}',flush=True)
    app.ThreadingHTTPServer(('127.0.0.1',app.PORT),app.Handler).serve_forever()
