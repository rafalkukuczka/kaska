"""Project company cards assembled from existing discovery and contact records."""
from collections import defaultdict
from datetime import date, timedelta
import json
from urllib.parse import urlsplit

import project_scope
from prospecting import clean_domain, safe_link
from public_data import norm


def company_name_key(name):
    return ' '.join(norm(name).split())


def domain_key(domain):
    try:
        return clean_domain(domain)
    except ValueError:
        return ''


def source_links(sources, fallback=''):
    return sorted({link for url in [fallback, *(source.get('url', '') for source in sources)]
                   if (link := safe_link(url))})


def read(c, key=None, *, today=None):
    project = project_scope.active(c)
    pool = project_scope.contact_pool(c, project)
    contacts = c.execute(
        "SELECT id,company,name,email,role,status,research_data FROM contacts WHERE contact_pool=? AND simulated=0 AND trim(company)!='' ORDER BY id",
        (pool,),
    ).fetchall()
    prospects = c.execute(
        """SELECT p.*,r.created FROM prospect_candidates p JOIN prospect_runs r ON r.id=p.run_id
           WHERE r.project_id=? ORDER BY r.created DESC,p.id DESC""", (project,),
    ).fetchall()
    signals = c.execute(
        """SELECT o.*,COALESCE(r.decision,'new') AS decision FROM discovered_opportunities o
           LEFT JOIN opportunity_reviews r ON r.opportunity_id=o.id AND r.project_id=o.project_id
           WHERE o.project_id=? ORDER BY o.updated DESC,o.id DESC""", (project,),
    ).fetchall()

    domains_by_name = defaultdict(set)
    for row in [*prospects, *signals]:
        domain = domain_key(row['domain'])
        if domain and row['company'].strip():
            domains_by_name[company_name_key(row['company'])].add(domain)

    firms = {}

    def firm(name, domain=''):
        name_key = company_name_key(name)
        if not domain and len(domains_by_name[name_key]) == 1:
            domain = next(iter(domains_by_name[name_key]))
        identity = 'domain:' + domain if domain else 'name:' + name_key
        return firms.setdefault(identity, {
            'key': identity, 'name': name.strip() or domain, 'domain': domain,
            'contacts': {}, 'assessments': {}, 'signals': {},
        })

    for row in prospects:
        company = firm(row['company'], domain_key(row['domain']))
        company['assessments'].setdefault(row['email'].casefold(), row)
    for row in signals:
        company = firm(row['company'], domain_key(row['domain']))
        company['signals'].setdefault(row['id'], row)
    for row in contacts:
        details = json.loads(row['research_data'])
        try:
            website_domain = domain_key(urlsplit(details.get('website', '')).hostname or '')
        except (ValueError, TypeError, AttributeError):
            website_domain = ''
        company = firm(row['company'], domain_key(details.get('domain', '')) or website_domain)
        company['contacts'][row['email'].casefold()] = row

    today = today or date.today()
    recent_since = (today - timedelta(days=30)).isoformat()
    recent_until = today.isoformat()

    def summarize(company):
        assessments = company['assessments']
        fit = {status: sum(row['qualification'] == status for row in assessments.values())
               for status in ('matched', 'uncertain', 'rejected')}
        opportunities = company['signals'].values()
        recent = sum(
            row['decision'] != 'rejected' and bool(row['quote'].strip()) and (
                recent_since <= row['published_date'] <= recent_until or
                recent_since <= row['event_date'] <= recent_until
            )
            for row in opportunities
        )
        return {
            **{field: company[field] for field in ('key', 'name', 'domain')},
            'fit': fit, 'recent_signals': recent,
            'signal_count': len(opportunities),
            'contact_count': len(company['contacts'].keys() | assessments.keys()),
        }

    if key is None:
        rows = [summarize(company) for company in firms.values()]
        return sorted(rows, key=lambda row: (-row['fit']['matched'], -row['recent_signals'], company_name_key(row['name']), row['key']))
    if key not in firms:
        raise ValueError('Nie znaleziono firmy w tym projekcie.')
    company = firms[key]
    people = []
    for email in company['contacts'].keys() | company['assessments'].keys():
        contact = company['contacts'].get(email)
        assessment = company['assessments'].get(email)
        person = contact if contact is not None else assessment
        item = {field: person[field] for field in ('name', 'email', 'role')}
        item['saved'] = contact is not None
        sources = set()
        if contact is not None:
            item['contact_id'] = contact['id']
            details = json.loads(contact['research_data'])
            sources.update(link for key in ('website','linkedin') if (link := safe_link(details.get(key, ''))))
            sources.update(source_links(details.get('sources') or []))
        if assessment is not None:
            item.update({field: assessment[field] for field in ('qualification', 'fit_reason', 'missing_data', 'created')})
            sources.update(source_links(json.loads(assessment['sources'])))
        if sources:
            item['sources'] = sorted(sources)
        people.append(item)
    return {
        **summarize(company),
        'contacts': sorted(people, key=lambda item: (not item['saved'], company_name_key(item['name']), item['email'])),
        'signals': [
            {**{field: row[field] for field in ('title', 'summary', 'quote', 'published_date', 'event_date', 'decision')},
             'sources': source_links(json.loads(row['sources']), row['url'])}
            for row in company['signals'].values()
        ],
    }
