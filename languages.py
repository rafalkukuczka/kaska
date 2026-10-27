"""Independent workspace, outreach and company-search language settings."""
SEARCH_LANGUAGE_NAMES={'pl':'Polish','en':'English','de':'German','fr':'French','es':'Spanish','it':'Italian'}


def validate_search_languages(value):
    if not isinstance(value,list) or len(value)>len(SEARCH_LANGUAGE_NAMES) or any(not isinstance(code,str) or code not in SEARCH_LANGUAGE_NAMES for code in value):
        raise ValueError('Wybierz języki wyszukiwania z listy.')
    return list(dict.fromkeys(value))
LANGUAGES = {
    'pl': {'label': 'Polski', 'prompt': 'polsku', 'subject': 'Pomysł dla {{company}}', 'follow_subject': 'Wracam do tematu',
           'body': 'Dzień dobry {{name}},\n\npiszę w sprawie współpracy z {{company}}.\n\n{{offer}}\n\nCzy to temat, o którym warto porozmawiać?',
           'follow_body': 'Dzień dobry {{name}},\n\nwracam do poprzedniej wiadomości. Czy warto porozmawiać o współpracy?',
           'material': 'Materiał do tematu: ', 'cta': 'Porozmawiajmy', 'footer': 'Nie chcesz kolejnych wiadomości? Odpowiedz STOP lub zrezygnuj: '},
    'en': {'label': 'English', 'prompt': 'angielsku', 'subject': 'An idea for {{company}}', 'follow_subject': 'Following up',
           'body': 'Hi {{name}},\n\nI am reaching out about working with {{company}}.\n\n{{offer}}\n\nWould this be worth a short conversation?',
           'follow_body': 'Hi {{name}},\n\nfollowing up on my previous message. Would it make sense to discuss working together?',
           'material': 'Related material: ', 'cta': 'Contact us', 'footer': 'To stop receiving these messages, reply STOP or unsubscribe: '},
    'de': {'label': 'Deutsch', 'prompt': 'niemiecku', 'subject': 'Eine Idee für {{company}}', 'follow_subject': 'Kurze Nachfrage',
           'body': 'Guten Tag {{name}},\n\nich melde mich wegen einer möglichen Zusammenarbeit mit {{company}}.\n\n{{offer}}\n\nWäre das ein Thema für ein kurzes Gespräch?',
           'follow_body': 'Guten Tag {{name}},\n\nich möchte auf meine vorherige Nachricht zurückkommen. Wäre ein Gespräch über eine Zusammenarbeit sinnvoll?',
           'material': 'Passendes Material: ', 'cta': 'Kontakt aufnehmen', 'footer': 'Wenn Sie keine weiteren Nachrichten wünschen, antworten Sie mit STOP oder melden Sie sich ab: '},
    'fr': {'label': 'Français', 'prompt': 'francusku', 'subject': 'Une idée pour {{company}}', 'follow_subject': 'Suite à mon message',
           'body': 'Bonjour {{name}},\n\nje vous contacte au sujet d’une éventuelle collaboration avec {{company}}.\n\n{{offer}}\n\nSeriez-vous disponible pour un bref échange ?',
           'follow_body': 'Bonjour {{name}},\n\nje reviens sur mon précédent message. Serait-il pertinent de discuter d’une collaboration ?',
           'material': 'Ressource complémentaire : ', 'cta': 'Contactez-nous', 'footer': 'Pour ne plus recevoir de messages, répondez STOP ou désabonnez-vous : '},
    'es': {'label': 'Español', 'prompt': 'hiszpańsku', 'subject': 'Una idea para {{company}}', 'follow_subject': 'Seguimiento de mi mensaje',
           'body': 'Hola {{name}},\n\nme pongo en contacto para explorar una colaboración con {{company}}.\n\n{{offer}}\n\n¿Tendría sentido una breve conversación?',
           'follow_body': 'Hola {{name}},\n\nquería retomar mi mensaje anterior. ¿Sería útil hablar de una posible colaboración?',
           'material': 'Material relacionado: ', 'cta': 'Hablemos', 'footer': 'Para dejar de recibir mensajes, responda STOP o cancele su suscripción: '},
    'it': {'label': 'Italiano', 'prompt': 'włosku', 'subject': 'Un’idea per {{company}}', 'follow_subject': 'Un breve seguito',
           'body': 'Buongiorno {{name}},\n\nla contatto per una possibile collaborazione con {{company}}.\n\n{{offer}}\n\nPotrebbe essere utile una breve conversazione?',
           'follow_body': 'Buongiorno {{name}},\n\nvorrei riprendere il mio messaggio precedente. Avrebbe senso parlare di una collaborazione?',
           'material': 'Materiale correlato: ', 'cta': 'Parliamone', 'footer': 'Per non ricevere altri messaggi, risponda STOP o annulli l’iscrizione: '},
}


def validate_language(value):
    if value not in LANGUAGES:
        raise ValueError('Nieobsługiwany język wiadomości. Dostępne: pl, en, de, fr, es, it.')
    return value


def init_schema(c):
    c.execute('CREATE TABLE IF NOT EXISTS app_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL)')


def preferences(db):
    with db() as c:
        stored = dict(c.execute('SELECT key,value FROM app_preferences'))
    return {'ui_language': stored.get('ui_language', 'pl'), 'message_language': stored.get('message_language', 'pl')}


def data_simulation(db):
    with db() as c:
        row=c.execute("SELECT value FROM app_preferences WHERE key='data_simulation'").fetchone()
    return None if row is None else row[0]=='on'


def save_data_simulation(db,item):
    if type(item.get('enabled')) is not bool:raise ValueError('Nieprawidłowe ustawienie symulacji.')
    with db() as c:
        c.execute("INSERT INTO app_preferences(key,value) VALUES('data_simulation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",('on' if item['enabled'] else 'off',))
    return {'enabled':item['enabled']}


def save_preferences(db, item):
    if not isinstance(item, dict) or not item or not set(item) <= {'ui_language', 'message_language'}:
        raise ValueError('Nieprawidłowe ustawienia języka')
    if 'ui_language' in item and item['ui_language'] not in ('pl', 'en'):
        raise ValueError('Język Kaśki: pl lub en')
    if 'message_language' in item:
        validate_language(item['message_language'])
    with db() as c:
        for key, value in item.items():
            c.execute('INSERT INTO app_preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
    return preferences(db)


def steps(language):
    spec = LANGUAGES[validate_language(language)]
    return [{'delay_days': 0, 'subject': spec['subject'], 'body': spec['body']},
            {'delay_days': 3, 'subject': spec['follow_subject'], 'body': spec['follow_body']}]
