"""Run the local Chrome browser process used by the campaign extension."""
import atexit
import itertools
import ipaddress
import json
import os
import socket
from pathlib import Path
import subprocess
import threading
from queue import Empty, Queue
from public_data import public_url


class HeadlessBrowser:
    def __init__(self, root, data):
        self.root = Path(root)
        self.profile = Path(data) / 'manual-chrome-profile'
        self.lock = threading.Lock()
        self.process = None
        self.pending = {}
        self.ids = itertools.count(1)
        atexit.register(self.close)

    def _start(self):
        try:
            self.process = subprocess.Popen(
                ['node', str(self.root / 'manual-headless.cjs'), str(self.profile)],
                cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        except OSError as error:
            raise ValueError('Do uruchomienia trybu headless potrzebny jest Node.js.') from error
        threading.Thread(target=self._receive, args=(self.process,), daemon=True).start()

    def _receive(self, process):
        try:
            for line in process.stdout:
                reply = json.loads(line)
                with self.lock:
                    response = self.pending.pop(reply.get('id'), None)
                    if response:
                        response.put(reply)
        finally:
            with self.lock:
                if self.process is process:
                    self.process = None
                    for response in self.pending.values():
                        response.put({'error': 'Proces Chrome headless został zakończony.'})
                    self.pending.clear()

    def contacts(self, url, source=None, *, follow_links=True):
        if not isinstance(url, str) or not 1 <= len(url) <= 2000 or (
                source is not None and (not isinstance(source, str) or not 1 <= len(source) <= 40000)):
            raise ValueError('Podaj poprawny adres strony do odczytu.')
        url = url.strip()
        if '://' not in url:
            url = 'https://' + url
        primary = public_url(url).hostname
        alternate = primary.removeprefix('www.') if primary.startswith('www.') else 'www.' + primary
        hosts = {}
        for host in (primary, alternate):
            try:
                addresses = {address[4][0] for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
            except OSError:
                addresses = set()
            ips = [ipaddress.ip_address(address) for address in addresses]
            if ips and all(ip.is_global and not ip.is_multicast for ip in ips):
                hosts[host] = sorted(addresses, key=lambda address: (':' in address, address))[0]
        if primary not in hosts:
            raise ValueError('Podaj publiczną stronę HTTPS, której domena jest dostępna.')
        args = {'url':url, 'hosts':hosts}
        if source is not None:
            args['source'] = source
        if not follow_links:
            args['followLinks'] = False
        return self.request({'method':'contact-research', 'args':args}, contacts=True)

    def request(self, item, *, contacts=False):
        if not isinstance(item, dict):
            raise ValueError('Nieprawidłowe polecenie Chrome headless.')
        method = item.get('method')
        if method not in ('create', 'get', 'query', 'script', 'events', 'login', 'login-status', 'close', 'research', 'contact-research'):
            raise ValueError('Nieznane polecenie Chrome headless.')
        if method == 'contact-research' and not contacts:
            raise ValueError('Otwórz formularz odczytu kontaktów.')
        args = item.get('args', {})
        if not isinstance(args, dict):
            raise ValueError('Nieprawidłowe parametry Chrome headless.')
        response = Queue()
        with self.lock:
            if self.process is None:
                if method == 'login-status':
                    return {'open': False}
                if method == 'events':
                    return {'events': []}
                if method == 'close':
                    return {}
                if method in ('get', 'script'):
                    raise ValueError('Karta headless została zamknięta.')
                self._start()
            request_id = next(self.ids)
            self.pending[request_id] = response
            try:
                self.process.stdin.write(json.dumps({'id': request_id, 'method': method, 'args': args},
                                                    ensure_ascii=True) + '\n')
                self.process.stdin.flush()
            except OSError as error:
                self.pending.pop(request_id, None)
                raise ValueError('Proces Chrome headless nie odpowiada.') from error
        try:
            reply = response.get(timeout={'script':600, 'contact-research':65}.get(method, 40))
        except Empty as error:
            with self.lock:
                self.pending.pop(request_id, None)
            raise ValueError('Przekroczono czas odpowiedzi Chrome headless.') from error
        if reply.get('error'):
            raise ValueError(reply['error'])
        return reply['result']

    def close(self):
        with self.lock:
            process = self.process
            if process is not None:
                process.stdin.close()
        if process is not None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
