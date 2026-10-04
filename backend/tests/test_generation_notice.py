from __future__ import annotations

from app.services.application_manager import (
    GenerationSuccessPayload,
    _clear_edited_generation_notices,
    _kept_original_section_count,
)
from app.services.resume_document import validate_resume_document


def _document(summary: str = "Built Python APIs.", notice: str | None = "kept_original_unverified") -> dict:
    return {"schema_version": 1, "revision": 2, "sections": [
        {"id": "summary", "kind": "summary", "heading": "Summary", "review_state": "reviewed",
         "content_md": summary, "generation_notice": notice},
        {"id": "skills", "kind": "skills", "heading": "Skills", "review_state": "reviewed", "content_md": "Python"},
    ]}


def test_generation_callback_accepts_and_counts_kept_original_sections():
    source = _document(notice=None)
    payload = GenerationSuccessPayload.model_validate({"content_md": "## Summary\nBuilt Python APIs.",
        "generation_params": {}, "sections_snapshot": {}, "document": _document(),
        "source_snapshot": {"document": source, "revision": source["revision"], "base_resume_id": "base-1"}})
    assert payload.document["sections"][0]["generation_notice"] == "kept_original_unverified"
    assert _kept_original_section_count(payload.document) == 1
    assert _kept_original_section_count(_document(notice=None)) == 0
    assert _kept_original_section_count(None) == 0


def test_editing_a_kept_original_section_clears_only_that_notice():
    previous = _document()
    edited = validate_resume_document(_document(summary="Built and documented Python APIs."))
    _clear_edited_generation_notices(edited, previous)
    assert edited.sections[0].generation_notice is None

    unchanged = validate_resume_document(_document())
    _clear_edited_generation_notices(unchanged, previous)
    assert unchanged.sections[0].generation_notice == "kept_original_unverified"


def test_progress_partial_sections_are_bounded_and_never_break_progress_reads():
    from app.api.applications import WorkflowProgress
    from app.services.progress import ProgressRecord

    base = {"job_id": "job-1", "workflow_kind": "generation", "state": "generating", "message": "Writing",
            "percent_complete": 40, "created_at": "t", "updated_at": "t", "completed_at": None, "terminal_error_code": None}
    partial = [{"id": "summary", "kind": "summary", "heading": "Summary", "content_md": "Built APIs."}]
    record = ProgressRecord.model_validate({**base, "partial_sections": partial})
    api = WorkflowProgress.model_validate(record.model_dump())
    assert api.partial_sections[0].content_md == "Built APIs."
    oversized = [{**partial[0], "content_md": "x" * 20_000}]
    assert ProgressRecord.model_validate({**base, "partial_sections": oversized}).partial_sections is None
    assert ProgressRecord.model_validate({**base, "partial_sections": "not a list"}).partial_sections is None
