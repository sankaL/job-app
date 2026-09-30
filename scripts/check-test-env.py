"""Reject hosted or non-development test configuration without printing secrets."""
import argparse
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlparse


def effective_values(env_file: Path, environment: dict[str, str]) -> dict[str, str]:
    values = {}
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\'')
    # Compose gives exported shell values precedence over --env-file values.
    return {**values, **environment}


def validate_values(values: dict[str, str], *, browser: bool = False) -> None:
    if values.get('APP_DEV_MODE', '').lower() != 'true' or values.get('APP_ENV') not in {'development', 'dev', 'test'}:
        raise ValueError('Testing requires APP_DEV_MODE=true and a development or test APP_ENV.')
    for key in ['DATABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL']:
        value = values.get(key, '')
        if value and urlparse(value).hostname not in {'localhost', '127.0.0.1', 'postgres'}:
            raise ValueError('Testing requires the Makefile-managed local database and auth stack.')
        if key == 'DATABASE_URL' and {'host', 'hostaddr', 'service', 'servicefile'} & dict(parse_qsl(urlparse(value).query)).keys():
            raise ValueError('Test database connections cannot override the local host through URI parameters.')
    if browser:
        for key, default in [('API_URL', 'http://localhost:54800'), ('APP_URL', 'http://localhost:5173')]:
            try:
                parsed = urlparse(values.get(key) or default)
                valid = parsed.scheme in {'http', 'https'} and parsed.hostname in {'localhost', '127.0.0.1'} and not parsed.username and not parsed.password
            except ValueError:
                valid = False
            if not valid:
                raise ValueError('Browser testing requires local API_URL and APP_URL, including exported shell overrides.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('env_file', type=Path)
    parser.add_argument('--browser', action='store_true')
    args = parser.parse_args()
    try:
        validate_values(effective_values(args.env_file, dict(os.environ)), browser=args.browser)
    except ValueError as error:
        raise SystemExit(str(error)) from None


if __name__ == '__main__':
    main()
