"""Server-side OpenAI Responses integration; credentials never enter API responses."""
import json
import os
import re
import urllib.error
import urllib.request

DEFAULT_MODEL = 'gpt-6-luna'


class InvalidAIOutput(ValueError):
    """A recoverable content error, distinct from credentials or provider failure."""


def ready():
    return bool(os.getenv('OPENAI_API_KEY', '').strip())


def model_name():
    return os.getenv('OPENAI_MODEL', '').strip() or DEFAULT_MODEL


def generate_json(instructions, data, fields, *, api_key=None, model=None, web_search=False, optional_fields=()):
    optional_fields=set(optional_fields)
    if not optional_fields.issubset(fields):raise ValueError('Nieprawidłowa konfiguracja opcjonalnych pól AI.')
    key = (os.getenv('OPENAI_API_KEY', '') if api_key is None else api_key).strip()
    model = model_name() if model is None else model.strip()
    if not key or not re.fullmatch(r'[!-~]+', key):
        raise ValueError('Podaj poprawny klucz API OpenAI w Integracjach.')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}', model):
        raise ValueError('Podaj poprawną nazwę modelu OpenAI.')
    payload = {'model': model, 'instructions': instructions,
               'input': json.dumps(data, ensure_ascii=False), 'store': False,
               'max_output_tokens': 4096,
               'text': {'format': {'type': 'json_schema', 'name': 'kaska_result', 'strict': True,
                   'schema': {'type': 'object', 'properties': {f: {'type': ['string','null'] if f in optional_fields else 'string'} for f in fields},
                              'required': list(fields), 'additionalProperties': False}}}}
    if web_search:
        payload.update(tools=[{'type': 'web_search'}], tool_choice='required',
                       include=['web_search_call.action.sources'])
    request = urllib.request.Request('https://api.openai.com/v1/responses',
        json.dumps(payload).encode('utf-8'),
        {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        # Never follow redirects with the authorization header.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError('Odpowiedź OpenAI jest zbyt duża.')
        result = json.loads(raw)
        if result.get('status') != 'completed':
            raise ValueError('OpenAI nie ukończyło generowania. Spróbuj ponownie lub zmień model.')
        parts = [part for item in result.get('output', []) if item.get('type') == 'message'
                 for part in item.get('content', [])]
        if any(p.get('type') == 'refusal' for p in parts):
            raise ValueError('OpenAI odmówiło wygenerowania tej treści. Zmień dane wejściowe.')
        generated = json.loads(''.join(p.get('text', '') for p in parts if p.get('type') == 'output_text'))
        if not isinstance(generated,dict) or set(generated)!=set(fields):
            raise InvalidAIOutput('Odpowiedź AI ma inny zestaw pól niż wymagany.')
        for field in optional_fields:
            if generated[field] is None or (isinstance(generated[field],str) and not generated[field].strip()):generated[field]=''
        invalid=[f for f in fields if not isinstance(generated[f],str) or (f not in optional_fields and not generated[f].strip())]
        if invalid:raise InvalidAIOutput('Nieprawidłowe lub puste wymagane pola odpowiedzi AI: '+', '.join(invalid)+'.')
        if web_search:
            searches=[item for item in result.get('output',[]) if item.get('type')=='web_search_call']
            if not searches:raise ValueError('Model nie wykonał wyszukiwania internetowego. Sprawdź obsługę wyszukiwania w wybranym modelu.')
            urls=[s.get('url','') for item in searches for s in item.get('action',{}).get('sources',[])]
            urls.extend(a.get('url','') for part in parts for a in part.get('annotations',[]) if a.get('type')=='url_citation')
            urls=list(dict.fromkeys(url for url in urls if isinstance(url,str) and url.startswith('https://')))[:100]
            return {'data':generated,'sources':urls}
        return generated
    except urllib.error.HTTPError as error:
        messages = {401: 'Nieprawidłowy klucz API OpenAI.', 403: 'Klucz OpenAI nie ma dostępu do tej usługi.',
                    404: 'Model OpenAI jest niedostępny. Sprawdź nazwę i dostęp na koncie.',
                    429: 'OpenAI: przekroczono limit żądań lub dostępne środki API. Sprawdź rozliczenia i spróbuj później.'}
        if web_search:messages[400]='Model odrzucił wyszukiwanie. Sprawdź, czy model wybrany w Integracjach obsługuje web search i wynik JSON.'
        raise ValueError(messages.get(error.code, 'OpenAI odrzuciło żądanie. Sprawdź model lub spróbuj później.')) from None
    except (OSError, TimeoutError):
        raise ValueError('Nie udało się połączyć z OpenAI. Sprawdź internet i spróbuj ponownie.') from None
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError):
        raise InvalidAIOutput('OpenAI zwróciło nieprawidłową odpowiedź. Spróbuj ponownie.') from None
