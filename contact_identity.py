"""Match contact identities within a single contact pool."""
import re
from urllib.parse import unquote, urlsplit


def linkedin_profile(value):
    if not isinstance(value, str):
        return ''
    try:
        url = urlsplit(value.strip())
        host = url.hostname or ''
        if (url.scheme not in ('http', 'https') or url.username is not None
                or not (host == 'linkedin.com' or host.endswith('.linkedin.com'))):
            return ''
    except ValueError:
        return ''
    profile = re.fullmatch(r'/in/([\w-]+)/?', unquote(url.path), re.IGNORECASE)
    return profile[1].casefold() if profile else ''


def find(connection, pool, email, linkedin=''):
    row = connection.execute('SELECT * FROM contacts WHERE contact_pool=? AND email=?', (pool, email)).fetchone()
    if row or not (profile := linkedin_profile(linkedin)):
        return row
    rows = connection.execute("""SELECT *, json_extract(research_data,'$.linkedin') AS profile_url
        FROM contacts WHERE contact_pool=? AND json_valid(research_data)
        AND json_extract(research_data,'$.linkedin') IS NOT NULL ORDER BY id""", (pool,))
    return next((row for row in rows if linkedin_profile(row['profile_url']) == profile), None)
