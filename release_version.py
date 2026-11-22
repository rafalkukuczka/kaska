"""Resolve the published version from a checkout or a tagged Git archive."""
import re
import subprocess


VERSION = re.compile(r'v\d+\.\d+(?:\.\d+)?')


def read(root):
    if (root / '.git').exists():
        try:
            version = subprocess.check_output(
                ['git', 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
                cwd=root, text=True, stderr=subprocess.DEVNULL, timeout=2,
            ).strip()
            if VERSION.fullmatch(version):
                return version
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        refs = (root / 'release-version.txt').read_text(encoding='utf-8')
    except OSError:
        return None
    tags = [ref.removeprefix('tag: ') for ref in refs.strip().split(', ') if ref.startswith('tag: ')]
    return max((tag for tag in tags if VERSION.fullmatch(tag)),
               key=lambda tag: tuple(map(int, tag[1:].split('.'))), default=None)
