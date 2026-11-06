"""Start Kaśka once, wait until ready, then open its browser window."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent


def configured_port():
    values = {}
    config = ROOT / '.env'
    if config.exists():
        for line in config.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                if key.strip() == 'APP_PORT':values['APP_PORT'] = value.strip()
    return int(os.environ.get('APP_PORT', values.get('APP_PORT', '8787')))


def ready(url):
    try:
        with urllib.request.urlopen(url+'/api/state', timeout=2) as response:
            data=json.load(response)
        if not isinstance(data,dict) or 'seller_project' not in data or 'campaigns' not in data:
            raise RuntimeError('Port jest zajety przez inna aplikacje.')
        return True
    except urllib.error.URLError as error:
        if isinstance(error,urllib.error.HTTPError):raise RuntimeError('Port jest zajety przez inna aplikacje.') from None
        return False
    except (ValueError,TimeoutError):
        raise RuntimeError('Nie mozna potwierdzic gotowosci aplikacji na tym porcie.') from None


def main():
    port=configured_port()
    if not 1 <= port <= 65535:raise ValueError('Nieprawidlowy APP_PORT.')
    url=f'http://localhost:{port}'
    if ready(url):
        print('Kaska juz dziala: '+url)
        webbrowser.open(url)
        return 0
    process=subprocess.Popen([sys.executable,'app.py'],cwd=ROOT)
    try:
        for _ in range(100):
            if process.poll() is not None:return process.returncode or 1
            if ready(url):
                print('Kaska: '+url+' | Zatrzymanie: Ctrl+C')
                webbrowser.open(url)
                return process.wait()
            time.sleep(.2)
        raise RuntimeError('Serwer nie uruchomil sie w oczekiwanym czasie.')
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    try:raise SystemExit(main())
    except KeyboardInterrupt:pass
    except (OSError,ValueError,RuntimeError) as error:
        print(str(error));raise SystemExit(1)
