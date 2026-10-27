"""A sequence entry condition: yes continues to email steps, no skips the recipient."""
import json

FIELDS = ('email', 'company', 'role')
OPERATORS = ('is_set', 'is_not_set', 'contains', 'equals', 'not_contains')


def validate(value):
    if not isinstance(value, list) or len(value) > 10:
        raise ValueError('Dodaj maksymalnie 10 warunków sekwencji.')
    result = []
    for item in value:
        if not isinstance(item, dict) or item.get('field') not in FIELDS or item.get('operator') not in OPERATORS:
            raise ValueError('Nieprawidłowy warunek sekwencji.')
        text = item.get('value', '')
        if not isinstance(text, str) or len(text) > 300:
            raise ValueError('Wartość warunku może mieć do 300 znaków.')
        if item['operator'] not in ('is_set', 'is_not_set') and not text.strip():
            raise ValueError('Uzupełnij wartość warunku.')
        result.append({'field': item['field'], 'operator': item['operator'], 'value': text.strip() if item['operator'] not in ('is_set', 'is_not_set') else ''})
    return result


def matches(conditions, contact):
    try:
        rules = validate(json.loads(conditions) if isinstance(conditions, str) else conditions)
        for rule in rules:
            value = str(dict(contact).get(rule['field']) or '').strip().casefold()
            target = rule['value'].casefold()
            ok = {'is_set': bool(value), 'is_not_set': not value,
                  'contains': target in value, 'equals': value == target,
                  'not_contains': target not in value}[rule['operator']]
            if not ok:
                return False
        return True
    except (ValueError, TypeError, KeyError):
        return False


def sql_matches(conditions, email, company, role):
    return int(matches(conditions, {'email': email, 'company': company, 'role': role}))
