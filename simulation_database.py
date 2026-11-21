"""Snapshot the workspace when application simulation is enabled."""
from contextlib import closing, contextmanager
from contextvars import ContextVar
from pathlib import Path
import secrets
import sqlite3
import threading


class SimulationDatabase:
    def __init__(self, primary, connect):
        self.primary = primary
        self.connect = connect
        self.scope = ContextVar('katie_simulation', default=None)
        self.lock = threading.Lock()
        self.readers = 0

    @property
    def path(self):
        return self.primary().with_suffix('.simulation.sqlite3')

    def _settings(self):
        with self.connect(self.primary()) as c:
            settings = dict(c.execute("SELECT key,value FROM app_preferences WHERE key IN ('data_simulation','simulation_generation')"))
        return settings.get('data_simulation') == 'on', settings.get('simulation_generation')

    @contextmanager
    def request(self):
        with self.lock:
            enabled, generation = self._settings()
            if enabled and (not generation or not self.path.is_file()):
                generation = self._set(True)
            if not enabled:
                generation = None
            if generation:
                self.readers += 1
        token = self.scope.set(generation)
        try:
            yield generation
        finally:
            self.scope.reset(token)
            if generation:
                with self.lock:
                    self.readers -= 1

    def set(self, item):
        enabled = item.get('enabled')
        if type(enabled) is not bool:
            raise ValueError('Nieprawidłowe ustawienie symulacji.')
        with self.lock:
            active, generation = self._settings()
            if (generation if active else None) != self.scope.get():
                raise ValueError('Zmieniono tryb aplikacji. Odśwież dane.')
            self._set(enabled)
        return {'enabled': enabled}

    def _set(self, enabled):
        active, generation = self._settings()
        generation = generation if enabled and active else None
        if enabled and (not generation or not self.path.is_file()):
            if self.readers:
                raise ValueError('Poczekaj na zakończenie bieżących operacji symulacji i spróbuj ponownie.')
            generation = secrets.token_hex(16)
            staging = Path(f'{self.path}.{generation}.tmp')
            try:
                with closing(sqlite3.connect(self.primary())) as source, closing(sqlite3.connect(staging)) as target:
                    source.backup(target)
                    target.execute('PRAGMA journal_mode=DELETE')
                    with target:
                        self._store_mode(target, True, generation)
                        target.execute("UPDATE campaigns SET status='paused' WHERE status='active'")
                        target.execute("UPDATE messages SET status='uncertain' WHERE status='sending'")
                        target.execute("UPDATE prospect_runs SET status='interrupted',stage='' WHERE status IN ('searching','verifying','drafting')")
                        target.execute("UPDATE opportunity_searches SET status='interrupted',stage='' WHERE status IN ('running','cancelling')")
                        target.execute("UPDATE lead_search_jobs SET status='cancelled',lease=0 WHERE status IN ('pending','running')")
                        target.execute("UPDATE discovery_pilots SET search_status='interrupted',search_detail='' WHERE search_status='running'")
                        target.execute("UPDATE discovery_tasks SET status='pending',lease=NULL,lease_until=NULL WHERE status='running'")
                staging.replace(self.path)
            finally:
                staging.unlink(missing_ok=True)
        with self.connect(self.primary()) as c:
            self._store_mode(c, enabled, generation)
        return generation

    @staticmethod
    def _store_mode(connection, enabled, generation):
        connection.executemany("""INSERT INTO app_preferences(key,value) VALUES(?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
            [('data_simulation', 'on' if enabled else 'off'), ('simulation_generation', generation or '')])
