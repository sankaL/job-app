"""Reject hosted or non-development test configuration without printing secrets."""
from pathlib import Path
import sys
from urllib.parse import urlparse

values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('\"\'')
if values.get('APP_DEV_MODE', '').lower() != 'true' or values.get('APP_ENV') not in {'development', 'dev', 'test'}:
    raise SystemExit('Testing requires APP_DEV_MODE=true and a development or test APP_ENV.')
for key in ['DATABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL']:
    value = values.get(key, '')
    if value and urlparse(value).hostname not in {'localhost', '127.0.0.1', 'postgres'}:
        raise SystemExit('Testing requires the Makefile-managed local database and auth stack.')
