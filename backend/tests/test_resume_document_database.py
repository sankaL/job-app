"""Exercise JSONB persistence, revision fences and RLS on the local test stack."""
import os
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest

from app.db.base_resumes import BaseResumeRepository
from app.db.resume_drafts import ResumeDraftRepository
from app.services.resume_document import parse_resume_document, render_resume_document


@pytest.fixture
def local_document_db():
    url = os.environ.get("DATABASE_URL", "")
    if os.environ.get("APP_DEV_MODE") != "true" or urlparse(url).hostname not in {"postgres", "localhost", "127.0.0.1"}:
        pytest.skip("Requires the Makefile-managed local development database.")
    users = [str(uuid4()), str(uuid4())]
    app_id = str(uuid4())
    with psycopg.connect(url) as connection:
        for user in users:
            connection.execute("insert into public.users (id,email,password_hash) values (%s,%s,%s)", (user, user + "@test.invalid", "test-only"))
        connection.execute("insert into public.applications (id,user_id,job_url,internal_state,visible_status) values (%s,%s,%s,%s,%s)", (app_id, users[0], "https://example.com/test", "generation_pending", "needs_action"))
    try:
        yield url, users, app_id
    finally:
        with psycopg.connect(url) as connection:
            connection.execute("delete from public.users where id = any(%s::uuid[])", (users,))


def test_source_and_draft_jsonb_are_scoped_and_revision_fenced(local_document_db):
    url, users, application_id = local_document_db
    source = parse_resume_document("## Skills\nPython, Postgres\n", reviewed=True)
    body = render_resume_document(source)
    bases = BaseResumeRepository(url)
    drafts = ResumeDraftRepository(url)
    base = bases.create_resume(user_id=users[0], name="Source", content_md=body, document=source.model_dump(mode="json"))
    assert bases.fetch_resume(users[1], base.id) is None
    snapshot = {"base_resume_id": base.id, "revision": 1, "document": base.document, "content_md": body}
    candidate = {**base.document, "revision": 12}
    draft = drafts.upsert_draft(application_id=application_id, user_id=users[0], content_md=body, generation_params={}, sections_snapshot={}, document=candidate, source_snapshot=snapshot)
    assert drafts.fetch_draft(users[1], application_id) is None
    assert draft.revision == draft.document["revision"] == 1
    edited = drafts.update_draft_content(application_id=application_id, user_id=users[0], content_md=body + "\n", document=draft.document, expected_revision=1)
    assert edited.revision == edited.document["revision"] == 2
    assert edited.sections_snapshot == {"enabled_sections": [source.sections[0].id], "section_order": [source.sections[0].id]}
    with pytest.raises(PermissionError, match="changed"):
        drafts.update_draft_content(application_id=application_id, user_id=users[0], content_md="stale", document=draft.document, expected_revision=1)
    updated_base = bases.update_resume(base.id, users[0], {"name": "New source"}, expected_revision=1)
    assert updated_base.revision == 2
    assert drafts.fetch_draft(users[0], application_id).source_snapshot == snapshot
    regenerated = drafts.upsert_draft(application_id=application_id, user_id=users[0], content_md=body, generation_params={}, sections_snapshot={}, document=source.model_dump(mode="json"), source_snapshot=snapshot)
    assert regenerated.revision == regenerated.document["revision"] == 3


def test_draft_section_layout_is_saved_atomically_without_rewriting_source(local_document_db):
    url, users, application_id = local_document_db
    drafts = ResumeDraftRepository(url)
    source = parse_resume_document("## Skills\nPython\n\n## Volunteering\nCommunity work\n", reviewed=True)
    document = source.model_dump(mode="json")
    snapshot = {"base_resume_id": str(uuid4()), "revision": 1, "document": document, "content_md": render_resume_document(source)}
    draft = drafts.upsert_draft(application_id=application_id, user_id=users[0], content_md=snapshot["content_md"], generation_params={}, sections_snapshot={}, document=document, source_snapshot=snapshot)
    edited_document = {**draft.document, "sections": list(reversed(draft.document["sections"]))}
    edited_document["sections"][1] = {**edited_document["sections"][1], "enabled": False}
    edited = drafts.update_draft_content(application_id=application_id, user_id=users[0], content_md=render_resume_document(edited_document), document=edited_document, expected_revision=1)
    assert edited.sections_snapshot == {"enabled_sections": [source.sections[1].id], "section_order": [source.sections[1].id]}
    assert edited.source_snapshot == snapshot
    assert edited.document["sections"][1]["content_md"] == "Python"
    with pytest.raises(PermissionError):
        drafts.update_draft_content(application_id=application_id, user_id=users[0], content_md="stale", document=document, expected_revision=1)
    assert drafts.fetch_draft(users[0], application_id).sections_snapshot == edited.sections_snapshot
    with pytest.raises(LookupError):
        drafts.update_draft_content(application_id=application_id, user_id=users[1], content_md="wrong user", document=document)


def test_resume_names_are_unique_per_user_for_create_and_rename(local_document_db):
    url, users, _ = local_document_db
    bases = BaseResumeRepository(url)
    base = bases.create_resume(user_id=users[0], name="Engineering", content_md="## Skills\nPython")
    # Other users may use the same name; case and surrounding spaces are ignored.
    bases.create_resume(user_id=users[1], name=" engineering ", content_md="## Skills\nSQL")
    with pytest.raises(PermissionError, match="Choose a different name"):
        bases.create_resume(user_id=users[0], name=" ENGINEERING ", content_md="## Skills\nSQL")
    other = bases.create_resume(user_id=users[0], name="Operations", content_md="## Skills\nSQL")
    with pytest.raises(PermissionError, match="Choose a different name"):
        bases.update_resume(other.id, users[0], {"name": "engineering"}, expected_revision=1)
    assert bases.fetch_resume(users[0], other.id).name == "Operations"
    assert bases.fetch_resume(users[0], other.id).revision == 1
    assert bases.update_resume(base.id, users[0], {"name": "ENGINEERING"}, expected_revision=1).name == "ENGINEERING"


def test_concurrent_resume_creation_rejects_one_duplicate(local_document_db):
    from concurrent.futures import ThreadPoolExecutor

    url, users, _ = local_document_db
    bases = BaseResumeRepository(url)

    def create():
        try:
            bases.create_resume(user_id=users[0], name="Concurrent", content_md="## Skills\nPython")
            return "created"
        except PermissionError:
            return "duplicate"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: create(), range(2)))
    assert sorted(results) == ["created", "duplicate"]


def test_name_migration_preserves_content_and_avoids_existing_suffixes(local_document_db):
    from pathlib import Path

    from psycopg.types.json import Jsonb

    url, users, _ = local_document_db
    document = parse_resume_document("## Skills\nOriginal", reviewed=True).model_dump(mode="json")
    migration = Path("/supabase/migrations/20260930_000022_unique_resume_names.sql").read_text()
    # Replay inside a rollback-only transaction without changing the migration ledger.
    migration = migration.replace("begin;", "", 1).removesuffix("commit;\n")
    with psycopg.connect(url) as connection:
        try:
            connection.execute("drop index public.base_resumes_user_name_unique")
            ids = [str(uuid4()) for _ in range(4)]
            for index, name in enumerate(["Source", " source ", "SOURCE", "Source (2)"]):
                connection.execute(
                    "insert into public.base_resumes (id,user_id,name,content_md,created_at,document) values (%s,%s,%s,%s,%s,%s)",
                    (ids[index], users[0], name, "## Skills\nOriginal", f"2026-09-30T00:00:0{index}Z", Jsonb(document)),
                )
            connection.execute(migration)
            rows = connection.execute("select id::text,name,revision,content_md,document from public.base_resumes where user_id = %s", (users[0],)).fetchall()
            indexed = {row[0]: row for row in rows}
            assert indexed[ids[0]][1:3] == ("Source", 1)
            assert indexed[ids[3]][1:3] == ("Source (2)", 1)
            assert {indexed[ids[1]][1].lower(), indexed[ids[2]][1].lower()} == {"source (3)", "source (4)"}
            assert all(indexed[id][2] == 2 for id in ids[1:3])
            assert all(row[3] == "## Skills\nOriginal" for row in rows)
            assert all(row[4] == {**document, "revision": row[2]} for row in rows)
        finally:
            connection.rollback()


def test_resume_library_summary_reads_current_document_and_preserves_ownership(local_document_db):
    from app.db.profiles import ProfileRepository
    from app.services.base_resumes import BaseResumeService
    from app.api.base_resumes import BaseResumeSummary
    url, users, _ = local_document_db
    repository = BaseResumeRepository(url)
    document = parse_resume_document("## Summary\n**Builds reliable tools.**\n\n## Skills\nPrivate skill text").model_dump(mode="json")
    record = repository.create_resume(user_id=users[0], name="Library", content_md="old content", document=document)
    service = BaseResumeService(repository, ProfileRepository(url))
    assert service.list_resumes(users[1]) == []
    rows = service.list_resumes(users[0])
    assert len(rows) == 1
    payload = BaseResumeSummary.model_validate(rows[0].model_dump()).model_dump()
    assert payload["id"] == record.id
    assert payload["summary"] == "Builds reliable tools."
    assert "summary_md" not in payload and "legacy_content_md" not in payload
    assert "Private skill text" not in str(payload)
    document["sections"][0]["content_md"] = "Updated summary."
    repository.update_resume(record.id, users[0], {"document": document}, expected_revision=1)
    assert service.list_resumes(users[0])[0].summary == "Updated summary."
    repository.create_resume(user_id=users[0], name="Legacy", content_md="## Summary\nLegacy summary.")
    assert any(row.summary == "Legacy summary." for row in service.list_resumes(users[0]))
