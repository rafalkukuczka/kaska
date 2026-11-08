"""Local rotating diagnostics without logging exception messages or secrets."""
import logging
from logging.handlers import RotatingFileHandler
import traceback


LOG = logging.getLogger('kaska')


def configure(directory):
    LOG.setLevel(logging.INFO)
    if LOG.handlers:
        return
    handler = RotatingFileHandler(directory / 'katie.log', maxBytes=2_000_000,
                                  backupCount=3, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(threadName)s %(message)s'))
    LOG.addHandler(handler)
    LOG.propagate = False


def log_error(context, exc):
    # Exception text can contain credentials, URLs, or submitted user data.
    LOG.error('%s (%s)\n%s', context, type(exc).__name__, ''.join(traceback.format_tb(exc.__traceback__)))
