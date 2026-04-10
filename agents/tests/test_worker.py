from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker import (
    BackendCallbackClient,
    EXTRACTION_TEXT_LIMIT,
    ExtractedJobPosting,
    JobProgress,
    OpenRouterExtractionAgent,
    PageContext,
    RedisProgressWriter,
    SourceCapture,
    WorkerSettingsEnv,
    build_generation_failure_payload,
    build_generation_success_payload,
    build_page_context_from_capture,
    detect_blocked_page,
    extract_reference_id,
    finalize_extracted_posting,
    is_current_job,
    normalize_origin_from_url,
    set_progress,
)


def build_context() -> PageContext:
    return PageContext(
        source_url="https://www.linkedin.com/jobs/view/1234567890",
        final_url="https://www.linkedin.com/jobs/view/1234567890",
        page_title="Senior Backend Engineer",
        meta={"og:title": "Senior Backend Engineer"},
        json_ld=[],
        visible_text="Requisition ID 1234567890. Join our engineering team.",
        detected_origin="linkedin",
        extracted_reference_id="1234567890",
    )


def test_normalize_origin_from_url_maps_common_sources():
    assert normalize_origin_from_url("https://www.linkedin.com/jobs/view/123") == "linkedin"
    assert normalize_origin_from_url("https://boards.greenhouse.io/acme/jobs/123") == "company_website"


def test_extract_reference_id_prefers_query_and_path_patterns():
    assert extract_reference_id("https://example.com/job?jobId=ABC123") == "abc123"
    assert extract_reference_id("https://www.linkedin.com/jobs/view/987654321") == "987654321"


def test_finalize_extracted_posting_uses_detected_origin_and_reference_id():
    posting = ExtractedJobPosting(
        job_title="Senior Backend Engineer",
        job_description="Build APIs and background systems.",
        company=None,
        job_location_text="British Columbia/Ontario",
        compensation_text="$150,000 - $180,000 per year",
        job_posting_origin=None,
        job_posting_origin_other_text=None,
        extracted_reference_id=None,
    )
    finalized = finalize_extracted_posting(posting, build_context())
    assert finalized.job_posting_origin == "linkedin"
    assert finalized.extracted_reference_id == "1234567890"
    assert finalized.job_location_text == "British Columbia/Ontario"
    assert finalized.compensation_text == "$150,000 - $180,000 per year"


def test_detect_blocked_page_extracts_provider_and_ray_id():
    context = PageContext(
        source_url="https://www.indeed.com/viewjob?jk=abc123",
        final_url="https://www.indeed.com/viewjob?jk=abc123",
        page_title="You have been blocked",
        meta={},
        json_ld=[],
        visible_text=(
            "You have been blocked. If you believe this in error, go to support.indeed.com. "
            "Your Ray ID for this request is 9e8afb060bd31117."
        ),
        detected_origin="indeed",
        extracted_reference_id="abc123",
    )

    blocked = detect_blocked_page(context)
    assert blocked is not None
    assert blocked.kind == "blocked_source"
    assert blocked.provider == "indeed"
    assert blocked.reference_id == "9e8afb060bd31117"


def test_build_page_context_from_capture_uses_source_text_and_origin():
    capture = SourceCapture(
        source_text="Backend Engineer at Acme. Requisition ID REQ-42.",
        source_url="https://boards.greenhouse.io/acme/jobs/req-42",
        page_title="Backend Engineer",
        meta={"og:title": "Backend Engineer"},
        json_ld=[],
        captured_at="2026-04-07T12:00:00+00:00",
    )

    context = build_page_context_from_capture("https://boards.greenhouse.io/acme/jobs/req-42", capture)
    assert context.detected_origin == "company_website"
    assert context.extracted_reference_id == "req-42"


def test_build_page_context_from_capture_preserves_longer_source_text_up_to_new_limit():
    long_text = "Qualifications\n" + ("Python APIs and distributed systems.\n" * 4000)
    capture = SourceCapture(source_text=long_text)

    context = build_page_context_from_capture("https://example.com/jobs/role", capture)

    assert len(context.visible_text) == EXTRACTION_TEXT_LIMIT
    assert context.visible_text.startswith("Qualifications")


class FakeExtractionAgent(OpenRouterExtractionAgent):
    def __init__(self) -> None:
        settings = WorkerSettingsEnv(
            openrouter_api_key="test",
            extraction_agent_model="primary-model",
            extraction_agent_fallback_model="fallback-model",
        )
        super().__init__(settings)
        self.calls: list[str] = []

    async def _extract_with_model(self, model_name: str, context: PageContext) -> ExtractedJobPosting:
        self.calls.append(model_name)
        if model_name == "primary-model":
            raise RuntimeError("primary failed")
        return ExtractedJobPosting(
            job_title="Senior Backend Engineer",
            job_description="Build APIs and background systems.",
            company="Acme",
            job_location_text="Toronto, ON",
            compensation_text="$140,000 - $170,000",
            job_posting_origin="company_website",
            extracted_reference_id="REQ-42",
        )


@pytest.mark.asyncio
async def test_extraction_agent_uses_fallback_model_after_primary_failure():
    agent = FakeExtractionAgent()
    result = await agent.extract(build_context())
    assert result.company == "Acme"
    assert result.job_location_text == "Toronto, ON"
    assert result.compensation_text == "$140,000 - $170,000"
    assert agent.calls == ["primary-model", "fallback-model"]


def test_build_generation_success_payload_nests_generated_fields():
    payload = build_generation_success_payload(
        application_id="app-1",
        user_id="user-1",
        job_id="job-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    assert payload["event"] == "succeeded"
    assert payload["generated"]["content_md"] == "# Resume"
    assert payload["generated"]["generation_params"]["page_length"] == "1_page"


def test_build_generation_failure_payload_normalizes_validation_errors():
    payload = build_generation_failure_payload(
        application_id="app-1",
        user_id="user-1",
        job_id="job-1",
        message="Resume validation failed.",
        terminal_error_code="generation_failed",
        validation_errors=[
            {"type": "hallucination", "section": "summary", "detail": "Invented employer"},
            "Missing required section: skills",
        ],
    )

    assert payload["event"] == "failed"
    assert payload["failure"]["terminal_error_code"] == "generation_failed"
    assert payload["failure"]["failure_details"]["validation_errors"] == [
        "summary: Invented employer",
        "Missing required section: skills",
    ]


@pytest.mark.asyncio
async def test_set_progress_ignores_stale_job_id():
    existing = JobProgress(
        job_id="job-current",
        workflow_kind="generation",
        state="generating",
        message="Current job is running.",
        percent_complete=50,
        created_at="2026-04-08T00:00:00+00:00",
        updated_at="2026-04-08T00:00:00+00:00",
    )

    class FakeWriter:
        def __init__(self) -> None:
            self.saved: list[JobProgress] = []

        async def get(self, _application_id: str):
            return existing

        async def set(self, _application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.saved.append(progress)

    writer = FakeWriter()
    result = await set_progress(
        writer,
        "app-1",
        job_id="job-stale",
        workflow_kind="generation",
        state="generation_failed",
        message="Stale write should be ignored.",
        percent_complete=100,
    )

    assert result == existing
    assert writer.saved == []
    assert await is_current_job(writer, "app-1", "job-stale") is False


@pytest.mark.asyncio
async def test_backend_callback_client_retries_transient_server_errors(monkeypatch):
    attempts = {"count": 0}

    class FakeResponse:
        def __init__(self, status_code: int) -> None:
            self.status_code = status_code

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                import httpx

                request = httpx.Request("POST", "https://example.com")
                raise httpx.HTTPStatusError("server error", request=request, response=httpx.Response(self.status_code))

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url: str, *, json, headers):
            del json, headers
            attempts["count"] += 1
            return FakeResponse(503 if attempts["count"] < 3 else 200)

    monkeypatch.setattr("worker.httpx.AsyncClient", FakeAsyncClient)

    settings = WorkerSettingsEnv(
        backend_api_url="https://backend.example",
        worker_callback_secret="secret",
    )
    client = BackendCallbackClient(settings)
    await client.post({"ok": True})

    assert attempts["count"] == 3
