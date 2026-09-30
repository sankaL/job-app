"""Seed one local, manually authored comparison fixture through backend repositories.

Run through the Makefile inside the local backend container. The synthetic account
and reviewed source must already exist; reruns never overwrite the fixture.

Use make test-local-guards before make test-browser. The browser target requires
loopback API_URL/APP_URL (including shell overrides) and a stopped local worker.
Then use make test-browser-seed, make test-browser-seed-check for a rolled-back
atomic insert check, and make test-browser-export for actual local HTTP exports.
Seeding/rollback checks have a 30s deadline. Export verification has a 75s deadline
plus at most 5s for logout after a failure. It checks bytes only in memory; normal
local export status/activity/notifications apply, while email and tracing stay off.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from io import BytesIO
import json
import re
import signal
import sys
from types import SimpleNamespace
from time import monotonic
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse
from uuid import uuid4
from xml.etree import ElementTree
from zipfile import ZipFile

from psycopg.types.json import Jsonb

from app.core.config import get_settings
from app.db.applications import ApplicationRepository
from app.db.base_resumes import BaseResumeRepository
from app.db.connection import rls_connection
from app.db.profiles import ProfileRepository
from app.db.resume_drafts import ResumeDraftRepository
from app.db.users import UserRepository
from app.services.application_manager import ApplicationService
from app.services.resume_document import (
    document_ready,
    render_resume_document,
    validate_resume_document,
)


SYNTHETIC_EMAIL = "section-walkthrough-20260930@test.invalid"
SOURCE_NAME = "Section walkthrough source"
FIXTURE_ID = "section-walkthrough-20260930"
FIXTURE_NOTE = "Synthetic section walkthrough fixture (20260930)."
JOB_DESCRIPTION = (
    "Synthetic local test posting: build and maintain Python APIs, improve API "
    "performance, and collaborate with an engineering team."
)


class FixtureSeedError(Exception):
    """A safe, content-free precondition or fixture failure."""


def guarded_database_url(settings) -> str:
    database = urlparse(settings.database_url)
    if (
        not settings.is_local_dev_mode
        or database.hostname != "postgres"
        or urlparse(settings.app_url).hostname not in {"localhost", "127.0.0.1"}
        or urlparse(settings.redis_url).hostname not in {"redis", "localhost", "127.0.0.1"}
    ):
        raise FixtureSeedError("Fixture seeding requires the Makefile-managed local dev stack.")
    if settings.email_notifications_enabled or settings.langsmith_tracing or settings.admin_emails:
        raise FixtureSeedError("Use the guarded browser stack with email, tracing, and admin bootstrap disabled.")
    if settings.openrouter_api_key != "test-only":
        raise FixtureSeedError("Use the guarded browser stack with the test-only provider key.")
    query = dict(parse_qsl(database.query))
    if {'host', 'hostaddr', 'service', 'servicefile'} & query.keys():
        raise FixtureSeedError("Local fixture connections cannot override the database host through URI parameters.")
    query["connect_timeout"] = "5"
    query["options"] = f"{query.get('options', '')} -c statement_timeout=10000 -c lock_timeout=5000".strip()
    # libpq decodes URI percent escapes, but does not treat '+' as a space.
    return urlunparse(database._replace(query=urlencode(query, quote_via=quote)))


def paraphrase_python_bullet(document):
    draft = document.model_copy(deep=True)
    for section in draft.sections:
        if not section.enabled or section.review_state != "reviewed":
            continue
        for entry in section.entries:
            for bullet in entry.bullets:
                if not re.search(r"\bPython\b", bullet.text, flags=re.I):
                    continue
                for pattern, replacement in (
                    (r"\bBuilt\b", "Developed"),
                    (r"\bDeveloped\b", "Built"),
                    (r"\busing Python\b", "with Python"),
                    (r"\bwith Python\b", "using Python"),
                    (r"\bUsed Python\b", "Worked with Python"),
                ):
                    text, count = re.subn(pattern, replacement, bullet.text, count=1, flags=re.I)
                    if count:
                        bullet.text = text
                        bullet.source_ids = [bullet.id]
                        draft.revision = 1
                        return validate_resume_document(draft.model_dump(mode="json"))
    raise FixtureSeedError("The reviewed source needs a Python bullet suitable for a factual wording change.")


def result_payload(*, created, application, draft, source_id, source_revision):
    return {
        "created": created,
        "application_id": application.id,
        "draft_id": draft.id,
        "base_resume_id": source_id,
        "source_revision": source_revision,
        "section_count": len((draft.document or {}).get("sections", [])),
        "changed_bullet_count": 1 if created else 0,
    }


def find_fixture(applications, drafts, user_id):
    existing = []
    for item in applications.list_applications(user_id):
        application = applications.fetch_application(user_id, item.id)
        draft = drafts.fetch_draft(user_id, item.id)
        if application is not None and (
            str(application.notes or "").startswith(FIXTURE_NOTE)
            or (draft is not None and draft.generation_params.get("_local_fixture") == FIXTURE_ID)
        ):
            existing.append((application, draft))
    if len(existing) > 1:
        raise FixtureSeedError("Multiple walkthrough fixtures exist; no data was changed.")
    if existing and existing[0][1] is None:
        raise FixtureSeedError("The existing walkthrough fixture has no draft; no data was changed.")
    return existing[0] if existing else None


def insert_fixture(cursor, *, user_id, base_id, source, draft_document, source_snapshot, content_md, keyword_payload):
    """Both rows use the caller's single scoped transaction; neither insert commits."""
    application_id, draft_id = str(uuid4()), str(uuid4())
    cursor.execute(
        """insert into public.applications
        (id, user_id, job_url, visible_status, internal_state, job_title, company,
         job_description, base_resume_id, notes, job_keywords)
        values (%s, %s, null, 'in_progress', 'resume_ready', %s, %s, %s, %s, %s, %s)""",
        (application_id, user_id, "Python Backend Engineer", "Walkthrough Demo Company",
         JOB_DESCRIPTION, base_id,
         f"{FIXTURE_NOTE} Manually seeded for local comparison; no AI generation or evaluation was run.",
         Jsonb(keyword_payload)),
    )
    cursor.execute(
        """insert into public.resume_drafts
        (id, application_id, user_id, content_md, generation_params, sections_snapshot,
         document, source_snapshot, revision, last_generated_at)
        values (%s, %s, %s, %s, %s, %s, %s, %s, 1, now())""",
        (draft_id, application_id, user_id, content_md,
         Jsonb({"base_resume_id": base_id, "page_length": "1_page", "aggressiveness": "medium",
                "_local_fixture": FIXTURE_ID, "_fixture_origin": "manual"}),
         Jsonb({"enabled_sections": [section.id for section in source.sections if section.enabled],
                "section_order": [section.id for section in source.sections]}),
         Jsonb(draft_document.model_dump(mode="json")), Jsonb(source_snapshot)),
    )
    return application_id, draft_id


def normalize_export_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


@contextmanager
def bounded_logout_deadline(seconds=5):
    """Bound total logout time and retain any earlier process alarm deadline."""
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_delay, previous_interval = signal.getitimer(signal.ITIMER_REAL)
    started = monotonic()
    earlier_deadline = previous_delay > 0 and previous_delay <= seconds

    def cleanup_timeout(signum, frame):
        if earlier_deadline and callable(previous_handler):
            previous_handler(signum, frame)
        raise FixtureSeedError("The synthetic logout exceeded its cleanup deadline.")

    signal.signal(signal.SIGALRM, cleanup_timeout)
    signal.setitimer(signal.ITIMER_REAL, min(seconds, previous_delay) if previous_delay > 0 else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        remaining = previous_delay - (monotonic() - started)
        if previous_delay > 0 and remaining <= 0 and previous_interval > 0:
            remaining = previous_interval - ((-remaining) % previous_interval)
        if previous_delay > 0 and remaining > 0:
            signal.setitimer(signal.ITIMER_REAL, remaining, previous_interval)


def verify_exports(*, application, draft, user, profile, settings) -> dict:
    import httpx
    import pdfplumber

    document = validate_resume_document(draft.document)
    enabled = [section for section in document.sections if section.enabled]
    bullets = [bullet.text for section in enabled for entry in section.entries for bullet in entry.bullets
               if re.search(r"\bPython\b", bullet.text, flags=re.I)]
    education = [section for section in enabled if section.kind == "education"]
    if not bullets or not education or not str(profile.name or "").strip():
        raise FixtureSeedError("Export verification requires the saved Python bullet, education, and profile name.")
    expected_education = [value for section in education for entry in section.entries
                          for key, value in entry.fields.items() if key in {"qualification", "institution"} and value.strip()]
    if not expected_education:
        raise FixtureSeedError("Export verification requires saved education facts.")
    base_url = f"http://127.0.0.1:{settings.api_port}"
    results = {}
    with httpx.Client(base_url=base_url, timeout=httpx.Timeout(25, connect=5), trust_env=False, follow_redirects=False) as client:
        login = client.post("/api/auth/login", json={"email": SYNTHETIC_EMAIL, "password": ""})
        try:
            if login.status_code != 200 or not login.json().get("access_token"):
                raise FixtureSeedError("The local synthetic account login failed.")
            client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
            identity = client.get("/api/auth/me")
            if identity.status_code != 200 or identity.json().get("id") != user.id:
                raise FixtureSeedError("Local export authentication did not match the synthetic account.")
            for format_name, media_type in (
                ("pdf", "application/pdf"),
                ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ):
                response = client.get(f"/api/applications/{application.id}/export-{format_name}")
                data = response.content
                checks = {
                    "http_ok": response.status_code == 200,
                    "content_type_ok": response.headers.get("content-type", "").split(";")[0] == media_type,
                    "attachment_ok": "attachment;" in response.headers.get("content-disposition", "")
                        and f".{format_name}" in response.headers.get("content-disposition", ""),
                    "magic_ok": data.startswith(b"%PDF-") if format_name == "pdf" else data.startswith(b"PK\x03\x04"),
                }
                if not all(checks.values()):
                    raise FixtureSeedError(f"Local {format_name.upper()} export response validation failed.")
                if format_name == "pdf":
                    with pdfplumber.open(BytesIO(data)) as pdf:
                        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
                else:
                    with ZipFile(BytesIO(data)) as archive:
                        xml = ElementTree.fromstring(archive.read("word/document.xml"))
                        text = " ".join(node.text or "" for node in xml.iter()
                                        if node.tag == "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
                normalized = normalize_export_text(text)
                checks.update({
                    "saved_python_bullet_ok": all(normalize_export_text(value) in normalized for value in bullets),
                    "education_ok": all(normalize_export_text(value) in normalized for value in expected_education),
                    "profile_header_ok": normalize_export_text(profile.name) in normalized
                        and normalize_export_text(profile.email) in normalized,
                })
                if not all(checks.values()):
                    raise FixtureSeedError(f"Local {format_name.upper()} export did not preserve the saved fixture content.")
                results[format_name] = {**checks, "byte_count": len(data)}
        finally:
            had_failure = sys.exc_info()[0] is not None
            try:
                with bounded_logout_deadline(5):
                    logout = client.post("/api/auth/logout", timeout=5)
                    if logout.status_code != 200:
                        raise FixtureSeedError("The synthetic export verification session could not be closed.")
            except Exception as error:
                if had_failure:
                    print(f"Synthetic session cleanup also failed ({type(error).__name__}).", file=sys.stderr)
                else:
                    raise FixtureSeedError("The synthetic export verification session could not be closed.") from None
    return results


def main(*, verify_export_mode=False, verify_atomic_mode=False) -> dict:
    settings = get_settings()
    database_url = guarded_database_url(settings)
    user = UserRepository(database_url).fetch_user_by_email(email=SYNTHETIC_EMAIL)
    if user is None or not user.is_active:
        raise FixtureSeedError("Log in with the synthetic walkthrough account before seeding.")
    profile = ProfileRepository(database_url).fetch_profile(user.id)
    if profile is None or not profile.is_active:
        raise FixtureSeedError("The synthetic walkthrough account needs an active local profile.")
    applications = ApplicationRepository(database_url)
    drafts = ResumeDraftRepository(database_url)
    bases = BaseResumeRepository(database_url)

    # Session advisory locking keeps simultaneous Make invocations from creating duplicates.
    with rls_connection(database_url, user_id=user.id) as connection, connection.cursor() as cursor:
        cursor.execute("select pg_try_advisory_lock(hashtext(%s)) as acquired", (FIXTURE_ID,))
        if not cursor.fetchone()["acquired"]:
            raise FixtureSeedError("Another walkthrough fixture seed is already running.")
        existing = find_fixture(applications, drafts, user.id)
        if existing and not verify_atomic_mode:
            application, draft = existing
            if verify_export_mode:
                return verify_exports(application=application, draft=draft, user=user, profile=profile, settings=settings)
            snapshot = draft.source_snapshot or {}
            return result_payload(
                created=False, application=application, draft=draft,
                source_id=snapshot.get("base_resume_id"), source_revision=snapshot.get("revision"),
            )
        if verify_export_mode:
            raise FixtureSeedError("Seed the local walkthrough fixture before verifying exports.")

        matches = [base for base in bases.list_resumes(user.id) if base.name == SOURCE_NAME]
        if len(matches) != 1:
            raise FixtureSeedError("Save exactly one walkthrough source base resume before seeding.")
        base = bases.fetch_resume(user.id, matches[0].id)
        if base is None or base.document is None:
            raise FixtureSeedError("The walkthrough source needs a structured resume document.")
        source = validate_resume_document(base.document)
        if source.revision != base.revision or not document_ready(source):
            raise FixtureSeedError("Review and save the walkthrough source sections before seeding.")
        draft_document = paraphrase_python_bullet(source)
        source_snapshot = {
            "base_resume_id": base.id,
            "revision": source.revision,
            "document": source.model_dump(mode="json"),
            "content_md": render_resume_document(source, include_disabled=True),
        }
        header = []
        if str(profile.name or "").strip():
            header.append(f"# {profile.name.strip()}")
        contact = [str(getattr(profile, key) or "").strip() for key in ("email", "phone", "address", "linkedin_url")]
        if any(contact):
            header.append(" | ".join(value for value in contact if value))
        content_md = "\n\n".join([*header, render_resume_document(draft_document).strip()]) + "\n"
        keyword_payload = ApplicationService._keyword_payload(
            status="succeeded",
            source_hash=ApplicationService._keyword_source_hash(JOB_DESCRIPTION),
            keywords=[], manual_keywords=["Python"],
            message="Synthetic local fixture with a manually selected keyword; no provider call.",
        )

        application_id, draft_id = insert_fixture(
            cursor, user_id=user.id, base_id=base.id, source=source, draft_document=draft_document,
            source_snapshot=source_snapshot, content_md=content_md, keyword_payload=keyword_payload,
        )
        if verify_atomic_mode:
            cursor.execute(
                """select
                (select count(*) from public.applications where user_id = %s and id = %s) as applications,
                (select count(*) from public.resume_drafts where user_id = %s and id = %s) as drafts""",
                (user.id, application_id, user.id, draft_id),
            )
            counts = cursor.fetchone()
            if counts != {"applications": 1, "drafts": 1}:
                raise FixtureSeedError("Atomic fixture rows were not both visible within their transaction.")
            connection.rollback()
            no_application = applications.fetch_application(user.id, application_id) is None
            no_draft = drafts.fetch_draft(user.id, application_id) is None
            unchanged_source = bases.fetch_resume(user.id, base.id)
            source_unchanged = unchanged_source is not None and unchanged_source.document == base.document and unchanged_source.revision == base.revision
            fixture_unchanged = True
            if existing:
                fixture_before = existing[1]
                fixture_after = drafts.fetch_draft(user.id, existing[0].id)
                fixture_unchanged = fixture_after is not None and all(
                    getattr(fixture_after, key) == getattr(fixture_before, key)
                    for key in ("content_md", "document", "revision", "source_snapshot")
                )
            checks = {"application_visible_in_transaction": True, "draft_visible_in_transaction": True,
                      "application_absent_after_rollback": no_application, "draft_absent_after_rollback": no_draft,
                      "source_unchanged": source_unchanged, "existing_fixture_unchanged": fixture_unchanged}
            if not all(checks.values()):
                raise FixtureSeedError("Atomic fixture rollback or source preservation verification failed.")
            return checks
        # A failed insert rolls back both rows on context exit. If commit's
        # outcome is unknown, both persisted rows still carry the rerun marker.
        connection.commit()
        return result_payload(
            created=True, application=SimpleNamespace(id=application_id),
            draft=SimpleNamespace(id=draft_id, document=draft_document.model_dump(mode="json")),
            source_id=base.id, source_revision=source.revision,
        )


def deadline_exceeded(_signal, _frame):
    raise FixtureSeedError("The local fixture operation exceeded its wall-clock deadline.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--verify-exports', action='store_true')
    modes.add_argument('--verify-atomic', action='store_true')
    args = parser.parse_args()
    signal.signal(signal.SIGALRM, deadline_exceeded)
    signal.alarm(75 if args.verify_exports else 30)
    try:
        result = main(verify_export_mode=args.verify_exports, verify_atomic_mode=args.verify_atomic)
    except FixtureSeedError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f"Local fixture seed failed ({type(error).__name__}); no source content was printed.", file=sys.stderr)
        sys.exit(1)
    else:
        print(json.dumps(result, sort_keys=True))
    finally:
        signal.alarm(0)
