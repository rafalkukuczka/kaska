"""Run the local Chrome browser process used by the campaign extension."""
import atexit
import itertools
import json
import os
from pathlib import Path
import subprocess
import threading
from queue import Empty, Queue


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

    def request(self, item):
        if not isinstance(item, dict):
            raise ValueError('Nieprawidłowe polecenie Chrome headless.')
        method = item.get('method')
        if method not in ('create', 'get', 'query', 'script', 'events', 'login', 'close'):
            raise ValueError('Nieznane polecenie Chrome headless.')
        args = item.get('args', {})
        if not isinstance(args, dict):
            raise ValueError('Nieprawidłowe parametry Chrome headless.')
        response = Queue()
        with self.lock:
            if self.process is None:
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
            reply = response.get(timeout=600 if method == 'script' else 40)
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
