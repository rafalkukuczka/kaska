"""Bounded Hunter -> Apollo enrichment. Provider assertions never verify an email."""
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import urlparse


class Apollo:
    def __init__(self, key=None):
        self.key = (os.getenv('APOLLO_API_KEY', '') if key is None else key).strip()
        if not re.fullmatch(r'[A-Za-z0-9_.-]{8,250}', self.key):
            raise ValueError('Podłącz klucz Apollo API w Integracjach.')

    def request(self, endpoint, body=None):
        if endpoint not in ('auth/health', 'mixed_people/api_search', 'people/match'):
            raise ValueError('Nieznana operacja Apollo.')
        request = urllib.request.Request('https://api.apollo.io/api/v1/' + endpoint,
            None if endpoint == 'auth/health' else json.dumps(body or {}).encode(),
            {'x-api-key': self.key, 'Content-Type': 'application/json', 'Accept': 'application/json'})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Odpowiedź Apollo jest zbyt duża.')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('error') or data.get('errors'):
                raise ValueError('Apollo zwróciło nieprawidłową odpowiedź.')
            return data
        except urllib.error.HTTPError as exc:
            raise ValueError({401: 'Nieprawidłowy klucz Apollo API.',
                403: 'Apollo: brak uprawnień do tej funkcji lub kredytów.',
                429: 'Apollo: limit zapytań. Spróbuj później.'}.get(exc.code,
                'Apollo odrzuciło zapytanie. Sprawdź uprawnienia klucza.')) from None
        except (OSError, TimeoutError):
            raise ValueError('Nie udało się połączyć z Apollo.') from None
        except (json.JSONDecodeError, TypeError):
            raise ValueError('Apollo zwróciło nieprawidłową odpowiedź.') from None

    def people(self, domain, limit, titles='', department='', exclude=()):
        self.warning = ''
        body = {'q_organization_domains_list': [domain], 'per_page': min(20, limit + len(exclude)), 'page': 1}
        if titles:
            body['person_titles'] = [title.strip() for title in titles.split(',') if title.strip()][:20]
        elif department:
            # Apollo has its own department taxonomy. Avoid silently substituting it.
            body['q_keywords'] = department
        result = self.request('mixed_people/api_search', body)
        people = result.get('people')
        if not isinstance(people, list):
            raise ValueError('Apollo nie zwróciło listy osób.')
        output = []
        attempted = set()
        # Hard bound on paid enrichment calls, including empty or duplicate results.
        for item in people[:limit]:
            if not isinstance(item, dict):
                continue
            person_id = item.get('person_id') or item.get('id')
            if not isinstance(person_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', person_id) or person_id in attempted:
                continue
            attempted.add(person_id)
            try:
                person = self.request('people/match', {'id': person_id, 'domain': domain,
                    'reveal_personal_emails': False, 'reveal_phone_number': False}).get('person')
            except ValueError as exc:
                if not output: raise
                self.warning = str(exc)
                break
            if not isinstance(person, dict):
                continue
            if person.get('email_status') not in ('verified', 'valid'):
                continue
            organization = person.get('organization') or {}
            if not isinstance(organization, dict):
                continue
            org_domain = str(organization.get('primary_domain') or '').lower().removeprefix('www.')
            if org_domain != domain:
                continue
            email = str(person.get('email') or '').strip().lower()
            if email in exclude:
                continue
            output.append({'value': email, 'first_name': str(person.get('first_name') or ''),
                'last_name': str(person.get('last_name') or ''), 'position': str(person.get('title') or ''),
                'type': 'personal', 'provenance': 'found', 'provider': 'Apollo',
                'sources': [{'uri': 'https://app.apollo.io/#/people/' + person_id,
                             'last_seen_on': '', 'kind': 'provider'}]})
        return output


def valid_people(rows, domain, excluded=()):
    """Keep usable named contacts with provenance; deduplicate case-insensitive emails."""
    seen = {email.lower() for email in excluded}
    for row in rows:
        if not isinstance(row, dict):
            continue
        email = str(row.get('value') or '').strip().lower()
        if (len(email) > 254 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', email)
                or email.rsplit('@', 1)[1] != domain or email in seen):
            continue
        if row.get('type') != 'personal' or row.get('provenance') not in (None, 'found'):
            continue
        if not any(str(row.get(field) or '').strip() for field in ('first_name', 'last_name')):
            continue
        raw = row.get('sources')
        if not isinstance(raw, list):
            continue
        sources = []
        for source in raw[:20]:
            if not isinstance(source, dict):
                continue
            try:
                link = str(source.get('uri') or '')[:2000]
                parsed = urlparse(link)
                if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or parsed.query:
                    continue
            except ValueError:
                continue
            sources.append({'uri': link, 'last_seen_on': str(source.get('last_seen_on') or '')[:100],
                            'kind': source.get('kind', 'email')})
        if not sources:
            continue
        seen.add(email)
        yield {**row, 'value': email, 'sources': sources}


def waterfall(hunter, domain, limit, titles='', department='', exclude=(), progress=None, hunter_params=None):
    """Use Apollo only for the missing slots. Retain successful results on failure."""
    params = dict(hunter_params or {'domain': domain, 'limit': limit, 'type': 'personal',
        'provenance': 'found', 'required_field': 'full_name', 'decision_maker': 'true'})
    if titles: params['job_titles'] = titles
    if department: params['department'] = department
    contacts, trace, data = [], [], {}
    try:
        if progress: progress('Hunter')
        data = hunter.request('domain-search', params)['data']
        if not isinstance(data, dict) or not isinstance(data.get('emails', []), list):
            raise ValueError('Hunter zwrócił nieprawidłową listę kontaktów.')
        found_domain = str(data.get('domain') or domain).lower().removeprefix('www.')
        if domain and found_domain != domain:
            raise ValueError('Hunter zwrócił inną domenę. Wynik nie został zapisany.')
        domain = found_domain
        contacts = list(valid_people(data.get('emails', []), domain, exclude))[:limit]
        contacts = [{**person, 'provider': 'Hunter'} for person in contacts]
        trace.append({'provider': 'Hunter', 'status': 'ok', 'added': len(contacts)})
    except ValueError as exc:
        trace.append({'provider': 'Hunter', 'status': 'error', 'added': 0, 'error': str(exc)})
        if 'inną domenę' in str(exc):
            raise
    missing = limit - len(contacts)
    if missing and domain and os.getenv('APOLLO_API_KEY', '').strip():
        try:
            if progress: progress('Apollo')
            apollo = Apollo()
            people = apollo.people(domain, missing, titles, department,
                set(exclude) | {person['value'] for person in contacts})
            extra = list(valid_people(people, domain, set(exclude) | {p['value'] for p in contacts}))[:missing]
            contacts.extend(extra)
            trace.append({'provider': 'Apollo', 'status': 'ok', 'added': len(extra)})
            if getattr(apollo, 'warning', ''):
                trace.append({'provider': 'Apollo', 'status': 'error', 'added': 0, 'error': apollo.warning})
        except ValueError as exc:
            trace.append({'provider': 'Apollo', 'status': 'error', 'added': 0, 'error': str(exc)})
    if not contacts and trace and all(step['status'] == 'error' for step in trace):
        raise ValueError(' '.join(step['error'] for step in trace))
    return {**data, 'domain': domain, 'emails': contacts, 'enrichment': trace}
