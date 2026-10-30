"""Bounded public HTTPS reads and shared text normalization."""
import http.client
import ipaddress
import re
import socket
import ssl
import time
import unicodedata
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse,urljoin


def norm(value):
    text = unicodedata.normalize('NFKD', str(value).casefold().replace('ł','l'))
    return ''.join(c for c in text if not unicodedata.combining(c))


def has_phrase(text, phrase):
    return bool(re.search(r'(?<!\w)' + re.escape(norm(phrase)) + r'(?!\w)', norm(text)))


def public_url(url):
    p = urlparse(str(url))
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.port not in (None,443):
        raise ValueError('Wymagany publiczny adres HTTPS bez danych logowania')
    return p


class FetchError(ValueError):
    def __init__(self,status,retry_after=None):
        super().__init__('Źródło zwróciło HTTP '+str(status));self.status=status;self.retry_after=retry_after


def fetch_public(url,max_bytes=1_000_000):
    for _ in range(4):
        p = public_url(url)
        addresses = socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError('Źródło nie może prowadzić do adresu prywatnego')
        conn = http.client.HTTPSConnection(p.hostname,timeout=15,context=ssl.create_default_context())
        raw = socket.create_connection((addresses[0][4][0],443),timeout=15)
        try:
            conn.sock = conn._context.wrap_socket(raw,server_hostname=p.hostname)
            conn.request('GET',(p.path or '/') + ('?'+p.query if p.query else ''),headers={'User-Agent':'Kaska/1.0','Accept':'application/rss+xml, application/atom+xml, application/json, text/html'})
            response = conn.getresponse()
            if response.status in (301,302,303,307,308):
                url=urljoin(url,response.getheader('Location',''))
                continue
            if response.status != 200:
                retry=response.getheader('Retry-After')
                try:retry=float(retry) if retry else None
                except ValueError:
                    try:retry=max(0,parsedate_to_datetime(retry).timestamp()-time.time())
                    except (ValueError,TypeError):retry=None
                raise FetchError(response.status,retry)
            content=response.read(max_bytes+1)
            if len(content)>max_bytes:
                raise ValueError('Źródło przekracza limit '+str(max_bytes//1_000_000)+' MB')
            return content.decode('utf-8-sig',errors='replace'),url
        finally:
            conn.close()
    raise ValueError('Zbyt wiele przekierowań źródła')

