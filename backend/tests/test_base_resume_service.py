from __future__ import annotations

from typing import Optional

import psycopg
import pytest

from app.db.base_resumes import BaseResumeRecord
from app.services.base_resumes import BaseResumeService
from app.services.resume_document import parse_resume_document


class StubBaseResumeRepository:
    def __init__(
        self,
        *,
        existing: bool = True,
        referenced: bool = False,
        delete_result: bool = True,
        delete_error: Optional[Exception] = None,
    ) -> None:
        self.existing = existing
        self.referenced = referenced
        self.delete_result = delete_result
        self.delete_error = delete_error
        self.delete_calls = 0

    def fetch_resume(self, user_id: str, resume_id: str) -> Optional[BaseResumeRecord]:
        if not self.existing:
            return None
        return BaseResumeRecord(
            id=resume_id,
            name="Backend Resume",
            user_id=user_id,
            content_md="# Resume",
            created_at="2026-04-07T12:00:00Z",
            updated_at="2026-04-07T12:00:00Z",
        )

    def is_referenced(self, resume_id: str, user_id: str) -> bool:
        return self.referenced

    def delete_resume(self, resume_id: str, user_id: str) -> bool:
        self.delete_calls += 1
        if self.delete_error is not None:
            raise self.delete_error
        return self.delete_result


class StubProfileRepository:
    def fetch_default_resume_id(self, user_id: str) -> Optional[str]:
        return None

    def update_default_resume(self, user_id: str, resume_id: Optional[str]) -> None:
        return None


def test_delete_resume_blocks_referenced_resume_without_force():
    repository = StubBaseResumeRepository(referenced=True)
    service = BaseResumeService(
        repo=repository,  # type: ignore[arg-type]
        profile_repo=StubProfileRepository(),  # type: ignore[arg-type]
    )

    with pytest.raises(ValueError, match="Use force=true to delete anyway."):
        service.delete_resume(user_id="user-1", resume_id="resume-1", force=False)

    assert repository.delete_calls == 0


def test_delete_resume_allows_referenced_resume_with_force():
    repository = StubBaseResumeRepository(referenced=True)
    service = BaseResumeService(
        repo=repository,  # type: ignore[arg-type]
        profile_repo=StubProfileRepository(),  # type: ignore[arg-type]
    )

    service.delete_resume(user_id="user-1", resume_id="resume-1", force=True)

    assert repository.delete_calls == 1


def test_delete_resume_raises_not_found_when_record_missing():
    repository = StubBaseResumeRepository(existing=False)
    service = BaseResumeService(
        repo=repository,  # type: ignore[arg-type]
        profile_repo=StubProfileRepository(),  # type: ignore[arg-type]
    )

    with pytest.raises(LookupError, match="Base resume not found."):
        service.delete_resume(user_id="user-1", resume_id="resume-1", force=True)


def test_delete_resume_maps_foreign_key_violation_to_permission_error():
    repository = StubBaseResumeRepository(
        referenced=True,
        delete_error=psycopg.errors.ForeignKeyViolation("fk violation"),
    )
    service = BaseResumeService(
        repo=repository,  # type: ignore[arg-type]
        profile_repo=StubProfileRepository(),  # type: ignore[arg-type]
    )

    with pytest.raises(PermissionError, match="related records still reference it"):
        service.delete_resume(user_id="user-1", resume_id="resume-1", force=True)


class MemoryResumeRepository(StubBaseResumeRepository):
    def __init__(self):
        super().__init__()
        self.record = None
        self.update_calls = 0
        self.last_expected_revision = None

    def create_resume(self, **kwargs):
        self.record = BaseResumeRecord(id="resume-1", revision=1, created_at="2026-09-30T12:00:00Z", updated_at="2026-09-30T12:00:00Z", **kwargs)
        return self.record

    def fetch_resume(self, user_id, resume_id):
        if self.record and self.record.id == resume_id and self.record.user_id == user_id:
            return self.record
        return None

    def update_resume(self, resume_id, user_id, updates, *, expected_revision=None):
        assert self.record.user_id == user_id
        assert self.record.id == resume_id
        assert expected_revision == self.record.revision
        self.last_expected_revision = expected_revision
        self.update_calls += 1
        self.record = BaseResumeRecord.model_validate({**self.record.model_dump(), **updates, "revision": self.record.revision + 1})
        return self.record


def _memory_service():
    repository = MemoryResumeRepository()
    return BaseResumeService(repo=repository, profile_repo=StubProfileRepository()), repository


def test_manual_markdown_resume_requires_review_and_keeps_markdown_projection():
    service, repository = _memory_service()
    record = service.create_resume(user_id="user-1", name=" My Resume ", content_md="## Skills\nPython, SQL\n\n## Volunteer Work\n- Coached a youth team.")
    assert record.name == "My Resume"
    assert not record.ready_for_generation
    assert record.needs_review
    assert [section["kind"] for section in record.document["sections"]] == ["skills", "custom"]
    assert repository.record.document == record.document


def test_structured_import_review_state_and_recoverable_source_are_persisted():
    service, repository = _memory_service()
    document = parse_resume_document("## Experience\nAcme | Toronto\nEngineer | 2020 - 2024\n- Built APIs.").model_dump(mode="json")
    record = service.create_resume(user_id="user-1", name="Import", content_md="", document=document, raw_source_md="original source", import_warning="Review uncertain fields.")
    assert record.needs_review
    assert not record.ready_for_generation
    assert repository.record.raw_source_md == "original source"
    assert record.import_warning == "Review uncertain fields."


def test_section_edit_preserves_ids_and_clears_warning_after_review():
    service, repository = _memory_service()
    document = parse_resume_document("## Skills\nPython, SQL").model_dump(mode="json")
    created = service.create_resume(user_id="user-1", name="Import", content_md="", document=document, import_warning="Review uncertain fields.")
    section = created.document["sections"][0]
    section["review_state"] = "reviewed"
    section["content_md"] = "Python, SQL, FastAPI"
    updated = service.update_resume("user-1", created.id, {"document": created.document, "expected_revision": 1})
    assert updated.document["sections"][0]["id"] == section["id"]
    assert "FastAPI" in updated.content_md
    assert updated.revision == updated.document["revision"] == 2
    assert updated.import_warning is None
    assert updated.ready_for_generation
    assert repository.last_expected_revision == 1


def test_stale_revision_does_not_overwrite_the_source():
    service, repository = _memory_service()
    created = service.create_resume(user_id="user-1", name="Resume", content_md="## Skills\nPython")
    service.update_resume("user-1", created.id, {"name": "Renamed", "expected_revision": 1})
    with pytest.raises(PermissionError, match="changed while you were editing"):
        service.update_resume("user-1", created.id, {"document": created.document, "expected_revision": 1})
    assert repository.record.name == "Renamed"
    assert repository.update_calls == 1


def test_disabled_source_section_is_kept_in_markdown_and_not_generation_ready():
    service, _repository = _memory_service()
    document = parse_resume_document("## Skills\nPython", reviewed=True).model_dump(mode="json")
    document["sections"][0]["enabled"] = False
    record = service.create_resume("user-1", "Resume", "", document=document)
    assert "Python" in record.content_md
    assert not record.ready_for_generation


def test_update_is_user_scoped_even_with_known_resume_id():
    service, repository = _memory_service()
    created = service.create_resume(user_id="user-1", name="Resume", content_md="## Skills\nPython")
    with pytest.raises(LookupError):
        service.update_resume("user-2", created.id, {"name": "Stolen"})
    assert repository.update_calls == 0


MANUAL_CONTACT_SOURCE = "Jane Doe\njane@example.com | 416-555-0100\n123 Main Street\n\n## Skills\nPython, SQL"


def test_manual_markdown_keeps_contact_local_and_preserves_original_source():
    service, repository = _memory_service()
    created = service.create_resume("user-1", "Resume", MANUAL_CONTACT_SOURCE)
    assert created.content_md == "## Skills\nPython, SQL\n"
    assert created.contact_suggestions["name"] == "Jane Doe"
    assert created.contact_suggestions["address"] == "123 Main Street"
    assert repository.record.raw_source_md == MANUAL_CONTACT_SOURCE
    assert "Jane Doe" not in str(created.document)
    assert "123 Main Street" not in str(created.document)
    assert created.needs_review and not created.ready_for_generation


def test_legacy_markdown_edit_retains_raw_contact_and_resets_review():
    service, repository = _memory_service()
    reviewed = parse_resume_document("## Skills\nPython", reviewed=True).model_dump(mode="json")
    created = service.create_resume("user-1", "Resume", "", document=reviewed)
    updated = service.update_resume("user-1", created.id, {"content_md": MANUAL_CONTACT_SOURCE, "expected_revision": 1})
    assert updated.contact_suggestions["email"] == "jane@example.com"
    assert updated.document["sections"][0]["review_state"] == "needs_review"
    assert "Jane Doe" not in str(updated.document)
    assert "123 Main Street" not in str(updated.document)
    assert repository.record.raw_source_md == MANUAL_CONTACT_SOURCE
    assert updated.revision == 2


def test_historical_base_resume_detail_sanitizes_contact_without_external_calls():
    service, repository = _memory_service()
    repository.record = BaseResumeRecord(id="resume-1", name="Old resume", user_id="user-1", content_md=MANUAL_CONTACT_SOURCE, created_at="2026-04-07T12:00:00Z", updated_at="2026-04-07T12:00:00Z")
    detail = service.get_resume("user-1", "resume-1")
    assert "Jane Doe" not in str(detail.document)
    assert "123 Main Street" not in str(detail.document)
    assert detail.contact_suggestions["name"] == "Jane Doe"
    assert detail.needs_review and not detail.ready_for_generation
    assert repository.record.content_md == MANUAL_CONTACT_SOURCE
