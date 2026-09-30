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
    with pytest.raises(PermissionError, match="changed"):
        drafts.update_draft_content(application_id=application_id, user_id=users[0], content_md="stale", document=draft.document, expected_revision=1)
    updated_base = bases.update_resume(base.id, users[0], {"name": "New source"}, expected_revision=1)
    assert updated_base.revision == 2
    assert drafts.fetch_draft(users[0], application_id).source_snapshot == snapshot
    regenerated = drafts.upsert_draft(application_id=application_id, user_id=users[0], content_md=body, generation_params={}, sections_snapshot={}, document=source.model_dump(mode="json"), source_snapshot=snapshot)
    assert regenerated.revision == regenerated.document["revision"] == 3
