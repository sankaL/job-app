"""Exercise local test guards without credentials or a real Docker daemon."""
from __future__ import annotations

import importlib.util
import ast
from contextlib import redirect_stderr
from contextlib import contextmanager
from io import StringIO
import json
import os
from pathlib import Path
import subprocess
import sys
import signal
import tempfile
from time import monotonic, sleep
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('test_environment_guard', ROOT / 'scripts/check-test-env.py')
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)
LOCAL_VALUES = {
    'APP_ENV': 'development', 'APP_DEV_MODE': 'true',
    'DATABASE_URL': 'postgresql://synthetic:synthetic@postgres/postgres',
    'API_URL': 'http://localhost:54800', 'APP_URL': 'http://localhost:5173',
}


class EnvironmentGuardTests(unittest.TestCase):
    def test_compose_example_keeps_tracing_an_explicit_opt_in(self):
        example = ROOT / '.env.compose.example'
        keys = ['LANGSMITH_TRACING', 'LANGSMITH_PROJECT', 'LANGSMITH_WORKSPACE_ID', 'LANGSMITH_API_KEY']
        assignments = [line.split('=', 1)[0] for line in example.read_text().splitlines()
                       if line and not line.startswith('#') and '=' in line]
        for key in keys:
            with self.subTest(key=key):
                self.assertEqual(assignments.count(key), 1)
        effective = GUARD.effective_values(example, {})
        self.assertEqual(effective['LANGSMITH_TRACING'], 'false')
        self.assertEqual(effective['LANGSMITH_PROJECT'], 'applix-dev')
        self.assertEqual(effective['LANGSMITH_API_KEY'], '')

    def test_local_browser_values_are_allowed(self):
        GUARD.validate_values(LOCAL_VALUES, browser=True)

    def test_hosted_database_auth_and_browser_urls_are_rejected(self):
        for key in ['DATABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'API_URL', 'APP_URL']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                GUARD.validate_values({**LOCAL_VALUES, key: 'https://hosted.test.invalid'}, browser=True)

    def test_shell_overrides_are_validated_with_compose_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / 'synthetic.env'
            env_file.write_text('\n'.join(f'{key}={value}' for key, value in LOCAL_VALUES.items()))
            for key in ['API_URL', 'APP_URL', 'DATABASE_URL']:
                effective = GUARD.effective_values(env_file, {key: 'https://hosted.test.invalid'})
                with self.subTest(key=key), self.assertRaises(ValueError):
                    GUARD.validate_values(effective, browser=True)
            env_file.write_text(env_file.read_text() + '\nAPI_URL=https://hosted.test.invalid\n')
            GUARD.validate_values(GUARD.effective_values(env_file, {'API_URL': 'http://127.0.0.1:54800'}), browser=True)

    def test_database_uri_cannot_override_its_local_authority(self):
        for parameter in ['host', 'hostaddr', 'service', 'servicefile']:
            with self.subTest(parameter=parameter), self.assertRaises(ValueError):
                GUARD.validate_values({**LOCAL_VALUES,
                    'DATABASE_URL': f'postgresql://synthetic:synthetic@postgres/postgres?{parameter}=hosted.test.invalid'})

    def make_browser(self, *, worker_state='stopped', overrides=None):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            env_file = directory / 'synthetic.env'
            env_file.write_text('\n'.join(f'{key}={value}' for key, value in LOCAL_VALUES.items()))
            docker = directory / 'docker'
            calls_file = directory / 'docker-calls.jsonl'
            docker.write_text(f'#!{sys.executable}\n' + '''import json, os, sys
with open(os.environ['GUARD_TEST_CALLS'], 'a') as output:
    output.write(json.dumps({'args': sys.argv[1:], 'test_key': os.environ.get('OPENROUTER_API_KEY') == 'test-only',
        'email_disabled': os.environ.get('EMAIL_NOTIFICATIONS_ENABLED') == 'false',
        'tracing_disabled': os.environ.get('LANGSMITH_TRACING') == 'false'}) + '\\n')
if 'ps' in sys.argv:
    state = os.environ['GUARD_TEST_WORKER_STATE']
    if state == 'unknown':
        sys.exit(1)
    if state == 'running':
        print('synthetic-worker-id')
''')
            docker.chmod(0o755)
            environment = {key: value for key, value in os.environ.items() if key not in {
                *LOCAL_VALUES, 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'MAKEFLAGS', 'MFLAGS',
            }}
            environment.update({'PATH': f'{directory}{os.pathsep}{environment.get("PATH", "")}',
                'GUARD_TEST_CALLS': str(calls_file), 'GUARD_TEST_WORKER_STATE': worker_state, **(overrides or {})})
            result = subprocess.run(['make', 'test-browser', f'ENV_FILE={env_file}'], cwd=ROOT,
                env=environment, capture_output=True, text=True, timeout=10)
            calls = [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []
            return result, calls

    def test_running_worker_blocks_startup_without_stopping_services(self):
        result, calls = self.make_browser(worker_state='running')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stopped explicitly', result.stdout)
        self.assertEqual(len(calls), 1)
        self.assertIn('ps', calls[0]['args'])

    def test_unknown_worker_state_fails_closed(self):
        result, calls = self.make_browser(worker_state='unknown')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unable to verify', result.stdout)
        self.assertEqual(len(calls), 1)

    def test_browser_startup_uses_only_guarded_services_and_flags(self):
        result, calls = self.make_browser()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        startup = calls[1]
        self.assertEqual(startup['args'][-4:], ['up', '-d', 'backend', 'frontend'])
        self.assertTrue(startup['test_key'] and startup['email_disabled'] and startup['tracing_disabled'])

    def test_effective_hosted_frontend_endpoint_blocks_docker_calls(self):
        result, calls = self.make_browser(overrides={'API_URL': 'https://hosted.test.invalid'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('exported shell overrides', result.stderr)
        self.assertEqual(calls, [])


class FixtureTransactionTests(unittest.TestCase):
    def setUp(self):
        # The helper has no connection or commit operation. Load it without the
        # backend runtime so these guard checks cannot open a real database.
        tree = ast.parse((ROOT / 'scripts/seed_section_walkthrough.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'insert_fixture')
        namespace = {'uuid4': uuid4, 'Jsonb': lambda value: value,
            'JOB_DESCRIPTION': 'Synthetic Python role', 'FIXTURE_NOTE': 'Synthetic fixture.', 'FIXTURE_ID': 'synthetic-fixture'}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<atomic fixture helper>', 'exec'), namespace)
        self.insert = namespace['insert_fixture']
        self.source = SimpleNamespace(sections=[SimpleNamespace(id='experience', enabled=True)])
        self.document = SimpleNamespace(model_dump=lambda **_: {'schema_version': 1, 'revision': 1, 'sections': []})

    def test_application_and_draft_ids_are_known_before_a_single_transaction_commit(self):
        calls = []
        cursor = SimpleNamespace(execute=lambda query, parameters: calls.append((query, parameters)))
        application_id, draft_id = self.insert(cursor, user_id='synthetic-user', base_id='synthetic-base',
            source=self.source, draft_document=self.document, source_snapshot={'revision': 2},
            content_md='Synthetic Python content', keyword_payload={})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1][:2], (application_id, 'synthetic-user'))
        self.assertEqual(calls[1][1][:3], (draft_id, application_id, 'synthetic-user'))
        self.assertIn('Synthetic fixture.', calls[0][1][6])
        self.assertEqual(calls[1][1][4]['_local_fixture'], 'synthetic-fixture')
        self.assertTrue(all('insert into' in query.lower() for query, _ in calls))

    def test_failed_draft_insert_propagates_without_commit_or_cleanup_side_effects(self):
        calls = []
        def execute(query, parameters):
            calls.append(query)
            if len(calls) == 2:
                raise TimeoutError('Synthetic insert deadline')
        with self.assertRaises(TimeoutError):
            self.insert(SimpleNamespace(execute=execute), user_id='synthetic-user', base_id='synthetic-base',
                source=self.source, draft_document=self.document, source_snapshot={'revision': 2},
                content_md='Synthetic Python content', keyword_payload={})
        self.assertEqual(len(calls), 2)
        self.assertTrue(all('insert into' in query.lower() for query in calls))


class ExportCleanupTests(unittest.TestCase):
    def verify_with_wrong_identity(self, *, logout_status):
        tree = ast.parse((ROOT / 'scripts/seed_section_walkthrough.py').read_text())
        definitions = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                       and node.name in {'FixtureSeedError', 'bounded_logout_deadline', 'verify_exports'}]
        calls = []
        class Client:
            headers = {}
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def post(self, path, **kwargs):
                calls.append((path, kwargs))
                if path.endswith('/login'):
                    return SimpleNamespace(status_code=200, json=lambda: {'access_token': 'synthetic-test-token'})
                return SimpleNamespace(status_code=logout_status)
            def get(self, path):
                return SimpleNamespace(status_code=200, json=lambda: {'id': 'different-synthetic-user'})
        document = SimpleNamespace(sections=[
            SimpleNamespace(enabled=True, kind='professional_experience', entries=[
                SimpleNamespace(bullets=[SimpleNamespace(text='Built Python APIs.')])]),
            SimpleNamespace(enabled=True, kind='education', entries=[
                SimpleNamespace(bullets=[], fields={'qualification': 'BSc', 'institution': 'Synthetic University'})]),
        ])
        namespace = {'re': __import__('re'), 'sys': sys, 'SYNTHETIC_EMAIL': 'synthetic@test.invalid',
                     'validate_resume_document': lambda _: document, 'contextmanager': contextmanager,
                     'signal': signal, 'monotonic': monotonic}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), '<export cleanup helper>', 'exec'), namespace)
        httpx = SimpleNamespace(Client=lambda **_: Client(), Timeout=lambda *_, **__: None)
        with patch.dict(sys.modules, {'httpx': httpx, 'pdfplumber': SimpleNamespace()}):
            with redirect_stderr(StringIO()) as stderr, self.assertRaisesRegex(
                namespace['FixtureSeedError'], 'did not match the synthetic account',
            ):
                namespace['verify_exports'](application=SimpleNamespace(id='synthetic-app'),
                    draft=SimpleNamespace(document={}), user=SimpleNamespace(id='synthetic-user'),
                    profile=SimpleNamespace(name='Synthetic Person', email='synthetic@test.invalid'),
                    settings=SimpleNamespace(api_port=8000))
        self.assertEqual([path for path, _ in calls], ['/api/auth/login', '/api/auth/logout'])
        self.assertEqual(calls[-1][1]['timeout'], 5)
        self.assertNotIn('synthetic-test-token', stderr.getvalue())
        return stderr.getvalue()

    def test_failed_post_login_validation_still_logs_out(self):
        self.assertEqual(self.verify_with_wrong_identity(logout_status=200), '')

    def test_logout_failure_preserves_original_failure_and_reports_safe_cleanup_type(self):
        self.assertIn('cleanup also failed (FixtureSeedError)', self.verify_with_wrong_identity(logout_status=500))


class LogoutDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.previous_handler = signal.getsignal(signal.SIGALRM)
        self.previous_timer = signal.getitimer(signal.ITIMER_REAL)
        tree = ast.parse((ROOT / 'scripts/seed_section_walkthrough.py').read_text())
        definitions = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                       and node.name in {'FixtureSeedError', 'bounded_logout_deadline'}]
        namespace = {'contextmanager': contextmanager, 'signal': signal, 'monotonic': monotonic}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), '<absolute logout deadline>', 'exec'), namespace)
        self.deadline = namespace['bounded_logout_deadline']
        self.error = namespace['FixtureSeedError']

    def tearDown(self):
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, self.previous_handler)
        signal.setitimer(signal.ITIMER_REAL, *self.previous_timer)

    def test_cleanup_has_absolute_bound_after_original_one_shot_alarm_expired(self):
        signal.setitimer(signal.ITIMER_REAL, 0)
        handler = signal.getsignal(signal.SIGALRM)
        with self.assertRaisesRegex(self.error, 'cleanup deadline'):
            with self.deadline(0.03):
                sleep(1)
        self.assertEqual(signal.getsignal(signal.SIGALRM), handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))

    def test_shorter_cleanup_preserves_prior_handler_and_remaining_deadline(self):
        def prior_handler(*_):
            raise AssertionError('Earlier overall deadline should not fire in this check.')
        signal.signal(signal.SIGALRM, prior_handler)
        signal.setitimer(signal.ITIMER_REAL, 2)
        with self.assertRaises(self.error):
            with self.deadline(0.03):
                sleep(1)
        remaining, interval = signal.getitimer(signal.ITIMER_REAL)
        self.assertEqual(signal.getsignal(signal.SIGALRM), prior_handler)
        self.assertTrue(0 < remaining < 2)
        self.assertEqual(interval, 0)

    def test_earlier_overall_deadline_is_honored_during_cleanup(self):
        def prior_handler(*_):
            raise self.error('Original overall deadline reached')
        signal.signal(signal.SIGALRM, prior_handler)
        signal.setitimer(signal.ITIMER_REAL, 0.03)
        with self.assertRaisesRegex(self.error, 'Original overall deadline reached'):
            with self.deadline(1):
                sleep(2)
        self.assertEqual(signal.getsignal(signal.SIGALRM), prior_handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))


if __name__ == '__main__':
    unittest.main()
