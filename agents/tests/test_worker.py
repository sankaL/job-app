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
    run_extraction_job,
    run_generation_job,
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

        async def clear_extracted_result(self, _application_id: str) -> None:
            return None

        async def set_extracted_result(
            self,
            _application_id: str,
            *,
            job_id: str,
            extracted: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del job_id, extracted, ttl_seconds
            return None

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


@pytest.mark.asyncio
async def test_run_extraction_job_continues_when_started_callback_fails(monkeypatch):
    class FakeWriter:
        def __init__(self) -> None:
            self.progress_by_app: dict[str, JobProgress] = {}
            self.extracted_by_app: dict[str, dict[str, object]] = {}

        async def get(self, application_id: str):
            return self.progress_by_app.get(application_id)

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.progress_by_app[application_id] = progress

        async def clear_extracted_result(self, application_id: str) -> None:
            self.extracted_by_app.pop(application_id, None)

        async def set_extracted_result(
            self,
            application_id: str,
            *,
            job_id: str,
            extracted: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del ttl_seconds
            self.extracted_by_app[application_id] = {"job_id": job_id, "extracted": extracted}

    class FakeCallback:
        def __init__(self) -> None:
            self.events: list[str] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/extraction-callback"):
            del path
            event = str(payload.get("event"))
            self.events.append(event)
            if event == "started":
                raise RuntimeError("backend temporarily unreachable")

    class FakeExtractor:
        async def extract(self, context: PageContext) -> ExtractedJobPosting:
            del context
            return ExtractedJobPosting(
                job_title="Senior Backend Engineer",
                job_description="Build APIs and background systems.",
                company="Acme",
                job_location_text="Toronto, ON",
                compensation_text="$140,000 - $170,000",
                job_posting_origin="linkedin",
                extracted_reference_id="1234567890",
            )

    fake_writer = FakeWriter()
    fake_callback = FakeCallback()

    monkeypatch.setattr("worker.WorkerSettingsEnv", lambda: WorkerSettingsEnv(redis_url="redis://unused"))
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: fake_callback)
    monkeypatch.setattr("worker.OpenRouterExtractionAgent", lambda _settings: FakeExtractor())

    async def fake_scrape(job_url: str) -> PageContext:
        del job_url
        return build_context()

    monkeypatch.setattr("worker.scrape_page_context", fake_scrape)

    result = await run_extraction_job(
        {},
        application_id="app-1",
        user_id="user-1",
        job_url="https://www.linkedin.com/jobs/view/1234567890",
        job_id="job-1",
    )

    assert result["job_title"] == "Senior Backend Engineer"
    assert fake_callback.events == ["started", "succeeded"]
    final_progress = await fake_writer.get("app-1")
    assert final_progress is not None
    assert final_progress.state == "generation_pending"


@pytest.mark.asyncio
async def test_run_extraction_job_returns_success_when_success_callback_fails(monkeypatch):
    class FakeWriter:
        def __init__(self) -> None:
            self.progress_by_app: dict[str, JobProgress] = {}
            self.extracted_by_app: dict[str, dict[str, object]] = {}

        async def get(self, application_id: str):
            return self.progress_by_app.get(application_id)

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.progress_by_app[application_id] = progress

        async def clear_extracted_result(self, application_id: str) -> None:
            self.extracted_by_app.pop(application_id, None)

        async def set_extracted_result(
            self,
            application_id: str,
            *,
            job_id: str,
            extracted: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del ttl_seconds
            self.extracted_by_app[application_id] = {"job_id": job_id, "extracted": extracted}

    class FakeCallback:
        def __init__(self) -> None:
            self.events: list[str] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/extraction-callback"):
            del path
            event = str(payload.get("event"))
            self.events.append(event)
            if event == "succeeded":
                raise RuntimeError("backend still unreachable")

    class FakeExtractor:
        async def extract(self, context: PageContext) -> ExtractedJobPosting:
            del context
            return ExtractedJobPosting(
                job_title="Senior Backend Engineer",
                job_description="Build APIs and background systems.",
                company="Acme",
                job_location_text="Toronto, ON",
                compensation_text="$140,000 - $170,000",
                job_posting_origin="linkedin",
                extracted_reference_id="1234567890",
            )

    fake_writer = FakeWriter()
    fake_callback = FakeCallback()

    monkeypatch.setattr("worker.WorkerSettingsEnv", lambda: WorkerSettingsEnv(redis_url="redis://unused"))
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: fake_callback)
    monkeypatch.setattr("worker.OpenRouterExtractionAgent", lambda _settings: FakeExtractor())

    async def fake_scrape(job_url: str) -> PageContext:
        del job_url
        return build_context()

    monkeypatch.setattr("worker.scrape_page_context", fake_scrape)

    result = await run_extraction_job(
        {},
        application_id="app-2",
        user_id="user-2",
        job_url="https://www.linkedin.com/jobs/view/1234567890",
        job_id="job-2",
    )

    assert result["job_title"] == "Senior Backend Engineer"
    assert fake_callback.events == ["started", "succeeded"]
    final_progress = await fake_writer.get("app-2")
    assert final_progress is not None
    assert final_progress.state == "generation_pending"


@pytest.mark.asyncio
async def test_run_generation_job_completes_and_caches_result_when_callbacks_fail(monkeypatch):
    class FakeWriter:
        def __init__(self) -> None:
            self.progress_by_app: dict[str, JobProgress] = {}
            self.generated_by_app: dict[str, dict[str, object]] = {}

        async def get(self, application_id: str):
            return self.progress_by_app.get(application_id)

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.progress_by_app[application_id] = progress

        async def clear_generation_result(self, application_id: str) -> None:
            self.generated_by_app.pop(application_id, None)

        async def set_generation_result(
            self,
            application_id: str,
            *,
            job_id: str,
            workflow_kind: str,
            generated: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del ttl_seconds
            self.generated_by_app[application_id] = {
                "job_id": job_id,
                "workflow_kind": workflow_kind,
                "generated": generated,
            }

    class FakeCallback:
        def __init__(self) -> None:
            self.events: list[str] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/generation-callback"):
            del path
            event = str(payload.get("event"))
            self.events.append(event)
            raise RuntimeError("backend unreachable")

    async def fake_generate_sections(**kwargs):
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(50, "Generating sections")
        return {"sections": [{"name": "summary", "content": "Built reliable APIs."}]}

    async def fake_validate_resume(**kwargs):
        del kwargs
        return {"valid": True, "errors": []}

    def fake_assemble_resume(**kwargs):
        del kwargs
        return "# Test Resume"

    fake_writer = FakeWriter()
    fake_callback = FakeCallback()

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: fake_callback)
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker.validate_resume", fake_validate_resume)
    monkeypatch.setattr("worker.assemble_resume", fake_assemble_resume)

    await run_generation_job(
        {},
        application_id="app-3",
        user_id="user-3",
        job_id="job-3",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs",
        personal_info={"name": "User"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
    )

    assert fake_callback.events == ["started", "succeeded"]
    final_progress = await fake_writer.get("app-3")
    assert final_progress is not None
    assert final_progress.state == "resume_ready"
    assert fake_writer.generated_by_app["app-3"]["job_id"] == "job-3"


@pytest.mark.asyncio
async def test_run_generation_job_validation_failure_does_not_crash_when_callback_fails(monkeypatch):
    class FakeWriter:
        def __init__(self) -> None:
            self.progress_by_app: dict[str, JobProgress] = {}

        async def get(self, application_id: str):
            return self.progress_by_app.get(application_id)

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.progress_by_app[application_id] = progress

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id
            return None

        async def set_generation_result(
            self,
            application_id: str,
            *,
            job_id: str,
            workflow_kind: str,
            generated: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del application_id, job_id, workflow_kind, generated, ttl_seconds
            return None

    class FakeCallback:
        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/generation-callback"):
            del payload, path
            raise RuntimeError("backend unreachable")

    async def fake_generate_sections(**kwargs):
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(50, "Generating sections")
        return {"sections": [{"name": "summary", "content": "Built reliable APIs."}]}

    async def fake_validate_resume(**kwargs):
        del kwargs
        return {"valid": False, "errors": ["Missing required section: skills"]}

    fake_writer = FakeWriter()

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: FakeCallback())
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker.validate_resume", fake_validate_resume)

    await run_generation_job(
        {},
        application_id="app-4",
        user_id="user-4",
        job_id="job-4",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs",
        personal_info={"name": "User"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
    )

    final_progress = await fake_writer.get("app-4")
    assert final_progress is not None
    assert final_progress.state == "generation_failed"
    assert final_progress.terminal_error_code == "validation_failed"


@pytest.mark.asyncio
async def test_run_generation_job_completes_when_generation_cache_write_fails(monkeypatch):
    class FakeWriter:
        def __init__(self) -> None:
            self.progress_by_app: dict[str, JobProgress] = {}

        async def get(self, application_id: str):
            return self.progress_by_app.get(application_id)

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del ttl_seconds
            self.progress_by_app[application_id] = progress

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id
            return None

        async def set_generation_result(
            self,
            application_id: str,
            *,
            job_id: str,
            workflow_kind: str,
            generated: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            del application_id, job_id, workflow_kind, generated, ttl_seconds
            raise RuntimeError("redis write failed")

    class FakeCallback:
        def __init__(self) -> None:
            self.events: list[str] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/generation-callback"):
            del path
            self.events.append(str(payload.get("event")))

    async def fake_generate_sections(**kwargs):
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(50, "Generating sections")
        return {"sections": [{"name": "summary", "content": "Built reliable APIs."}]}

    async def fake_validate_resume(**kwargs):
        del kwargs
        return {"valid": True, "errors": []}

    def fake_assemble_resume(**kwargs):
        del kwargs
        return "# Test Resume"

    fake_writer = FakeWriter()
    fake_callback = FakeCallback()

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: fake_callback)
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker.validate_resume", fake_validate_resume)
    monkeypatch.setattr("worker.assemble_resume", fake_assemble_resume)

    await run_generation_job(
        {},
        application_id="app-5",
        user_id="user-5",
        job_id="job-5",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs",
        personal_info={"name": "User"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
    )

    final_progress = await fake_writer.get("app-5")
    assert final_progress is not None
    assert final_progress.state == "resume_ready"
    assert fake_callback.events == ["started", "succeeded"]
