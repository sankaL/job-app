from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worker
from worker import (
    BackendCallbackClient,
    EXTRACTION_TEXT_LIMIT,
    ExtractedJobPosting,
    ExtractedKeywordPayload,
    FULL_GENERATION_MAX_TIMEOUT_SECONDS,
    JobProgress,
    OpenRouterExtractionAgent,
    OutboundRequestGuard,
    PageContext,
    RedisProgressWriter,
    SourceCapture,
    WorkerSettingsEnv,
    build_generation_failure_payload,
    build_generation_success_payload,
    build_job_keywords_payload,
    build_page_context_from_capture,
    detect_blocked_page,
    extract_reference_id,
    filter_keywords_to_job_description,
    finalize_extracted_posting,
    keyword_occurs_exact_case_insensitive,
    is_current_job,
    normalize_origin_from_url,
    run_extraction_job,
    run_generation_job,
    run_keyword_extraction_job,
    run_resume_judge_job,
    set_progress,
)


class _FakeRoute:
    def __init__(self, url: str) -> None:
        self.request = type("Request", (), {"url": url})()
        self.continued = False
        self.aborted_with: str | None = None

    async def continue_(self) -> None:
        self.continued = True

    async def abort(self, reason: str) -> None:
        self.aborted_with = reason


@pytest.mark.asyncio
async def test_outbound_request_guard_blocks_private_redirect_or_subresource():
    validated: list[str] = []

    async def validator(url: str) -> None:
        validated.append(url)
        if "127.0.0.1" in url:
            raise ValueError("private")

    guard = OutboundRequestGuard(validator=validator)
    public_route = _FakeRoute("https://jobs.example.com/opening")
    private_route = _FakeRoute("http://127.0.0.1/admin")

    await guard(public_route)  # type: ignore[arg-type]
    await guard(private_route)  # type: ignore[arg-type]

    assert public_route.continued is True
    assert private_route.aborted_with == "blockedbyclient"
    assert guard.blocked_request is True
    assert validated == ["https://jobs.example.com/opening", "http://127.0.0.1/admin"]


@pytest.mark.asyncio
async def test_outbound_request_guard_caches_validated_hosts_and_allows_data_urls():
    validated: list[str] = []

    async def validator(url: str) -> None:
        validated.append(url)

    guard = OutboundRequestGuard(validator=validator)
    first = _FakeRoute("https://jobs.example.com/a")
    second = _FakeRoute("https://jobs.example.com/b")
    data_route = _FakeRoute("data:text/plain,safe")

    await guard(first)  # type: ignore[arg-type]
    await guard(second)  # type: ignore[arg-type]
    await guard(data_route)  # type: ignore[arg-type]

    assert first.continued and second.continued and data_route.continued
    assert validated == ["https://jobs.example.com/a"]


def build_generation_result() -> dict[str, object]:
    return {
        "sections": [
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nBuilt reliable APIs.",
                "supporting_snippets": ["Built reliable APIs."],
            }
        ],
        "model_used": "primary-model",
        "attempt_diagnostics": [
            {
                "model": "primary-model",
                "reasoning_effort": None,
                "transport_mode": "structured",
                "outcome": "success",
                "elapsed_ms": 25,
            }
        ],
        "prompt": [("system", "sys"), ("human", "{}")],
        "section_ids": ["summary"],
        "operation": "generation",
        "professional_experience_anchors": [],
    }


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


def test_filter_keywords_keeps_only_exact_job_description_phrases():
    job_description = "We need React Native, CI/CD, and Kubernetes experience. React Native appears twice."

    keywords = filter_keywords_to_job_description(
        ["react native", "CI CD", "Kubernetes", "container orchestration", "React Native"],
        job_description,
    )

    assert keywords == ["react native", "Kubernetes"]


def test_keyword_occurs_exact_case_insensitive_rejects_variants():
    assert keyword_occurs_exact_case_insensitive("React Native", "react native experience")
    assert not keyword_occurs_exact_case_insensitive("React Native", "React-Native experience")
    assert not keyword_occurs_exact_case_insensitive("Kubernetes", "Kubernetess")
    assert keyword_occurs_exact_case_insensitive("C++", "C++ experience")
    assert not keyword_occurs_exact_case_insensitive("C++", "C++17 experience")
    assert not keyword_occurs_exact_case_insensitive("C#", "C#Developer role")


def test_build_job_keywords_payload_uses_ordered_keyword_objects():
    payload = build_job_keywords_payload(
        status="succeeded",
        job_description="Build APIs.",
        keywords=["Build APIs"],
        model_used="cheap-model",
        job_id="job-1",
    )

    assert payload["status"] == "succeeded"
    assert payload["keywords"] == [{"text": "Build APIs", "source": "extracted"}]
    assert payload["model_used"] == "cheap-model"
    assert payload["job_id"] == "job-1"


@pytest.mark.asyncio
async def test_keyword_extraction_falls_back_after_primary_timeout(monkeypatch):
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        keyword_extraction_agent_model="primary-keyword-model",
        keyword_extraction_agent_fallback_model="fallback-keyword-model",
    )
    agent = worker.OpenRouterKeywordExtractionAgent(settings)
    attempts: list[str] = []

    async def fake_extract_with_model(model_name: str, job_description: str) -> ExtractedKeywordPayload:
        del job_description
        attempts.append(model_name)
        if model_name == "primary-keyword-model":
            raise asyncio.TimeoutError()
        return ExtractedKeywordPayload(keywords=["React Native"])

    monkeypatch.setattr(agent, "_extract_with_model", fake_extract_with_model)

    payload, model_used = await agent.extract_keywords("Build React Native applications.")

    assert attempts == ["primary-keyword-model", "fallback-keyword-model"]
    assert model_used == "fallback-keyword-model"
    assert payload["keywords"] == [{"text": "React Native", "source": "extracted"}]


@pytest.mark.asyncio
async def test_run_keyword_extraction_job_posts_failed_callback_on_timeout(monkeypatch):
    class FakeCallback:
        def __init__(self, _settings: WorkerSettingsEnv) -> None:
            self.payloads: list[dict[str, object]] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/extraction-callback"):
            self.payloads.append({"path": path, **payload})

    class FakeKeywordExtractor:
        def __init__(self, _settings: WorkerSettingsEnv) -> None:
            pass

        async def extract_keywords(self, job_description: str):
            del job_description
            raise asyncio.TimeoutError()

    fake_callback = FakeCallback(WorkerSettingsEnv())
    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(redis_url="redis://unused", openrouter_api_key="test-key"),
    )
    monkeypatch.setattr("worker.BackendCallbackClient", lambda settings: fake_callback)
    monkeypatch.setattr("worker.OpenRouterKeywordExtractionAgent", FakeKeywordExtractor)

    job_description = "Build React Native applications."
    result = await run_keyword_extraction_job(
        {},
        application_id="app-1",
        user_id="user-1",
        job_id="keyword-job-1",
        job_description=job_description,
        source_hash=worker.keyword_source_hash(job_description),
    )

    assert result["event"] == "failed"
    assert [payload["event"] for payload in fake_callback.payloads] == ["started", "failed"]
    assert fake_callback.payloads[-1]["path"] == worker.KEYWORD_EXTRACTION_CALLBACK_PATH


def test_normalize_origin_from_url_maps_common_sources():
    assert normalize_origin_from_url("https://www.linkedin.com/jobs/view/123") == "linkedin"
    assert normalize_origin_from_url("https://boards.greenhouse.io/acme/jobs/123") == "company_website"


def test_resolve_generation_models_reports_blank_tier_model():
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        generation_agent_model="env-primary-model",
        generation_agent_fallback_model="env-fallback-model",
    )

    with pytest.raises(RuntimeError, match="Tier generation model is blank"):
        worker._resolve_generation_models(
            {
                "_generation_model": " ",
                "_generation_fallback_model": "openai/gpt-5.4-mini",
            },
            settings,
        )


def test_resolve_generation_models_reports_none_tier_model():
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        generation_agent_model="env-primary-model",
        generation_agent_fallback_model="env-fallback-model",
    )

    with pytest.raises(RuntimeError, match="Tier generation model is blank"):
        worker._resolve_generation_models(
            {
                "_generation_model": None,
                "_generation_fallback_model": "google/gemini-3.5-flash",
            },
            settings,
        )


def test_resolve_generation_models_rejects_same_model():
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        generation_agent_model="env-primary-model",
        generation_agent_fallback_model="env-fallback-model",
    )

    with pytest.raises(RuntimeError, match="fallback model must differ"):
        worker._resolve_generation_models(
            {
                "_generation_model": "google/gemini-3-flash-preview",
                "_generation_fallback_model": "google/gemini-3-flash-preview",
            },
            settings,
        )


def test_resolve_generation_models_rejects_unknown_tier_model():
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        generation_agent_model="env-primary-model",
        generation_agent_fallback_model="env-fallback-model",
    )

    with pytest.raises(RuntimeError, match="Tier generation model is not supported"):
        worker._resolve_generation_models(
            {
                "_generation_model": "unknown/provider",
                "_generation_fallback_model": "google/gemini-3.5-flash",
            },
            settings,
        )


def test_resolve_generation_models_accepts_deepseek_tier_model():
    settings = WorkerSettingsEnv(
        openrouter_api_key="test-key",
        generation_agent_model="env-primary-model",
        generation_agent_fallback_model="env-fallback-model",
    )

    primary_model, fallback_model = worker._resolve_generation_models(
        {
            "_generation_model": "deepseek/deepseek-v4-flash",
            "_generation_fallback_model": "openai/gpt-5.4-mini",
        },
        settings,
    )

    assert primary_model == "deepseek/deepseek-v4-flash"
    assert fallback_model == "openai/gpt-5.4-mini"


def test_resolve_generation_reasoning_efforts_rejects_invalid_value():
    settings = WorkerSettingsEnv(openrouter_api_key="test-key")

    with pytest.raises(RuntimeError, match="reasoning effort is invalid"):
        worker._resolve_generation_reasoning_efforts(
            {"_generation_reasoning_effort": "enormous"},
            settings,
        )


def test_resolve_generation_reasoning_efforts_rejects_unsupported_model_tier():
    settings = WorkerSettingsEnv(openrouter_api_key="test-key")

    with pytest.raises(RuntimeError, match="not supported by the generation model"):
        worker._resolve_generation_reasoning_efforts(
            {
                "_generation_model": "google/gemini-3-flash-preview",
                "_generation_reasoning_effort": "xhigh",
            },
            settings,
        )


@pytest.mark.parametrize("reasoning_effort", ["none", "high", "xhigh"])
def test_resolve_generation_reasoning_efforts_accepts_deepseek_supported_values(reasoning_effort: str):
    settings = WorkerSettingsEnv(openrouter_api_key="test-key")

    primary_reasoning, fallback_reasoning = worker._resolve_generation_reasoning_efforts(
        {
            "_generation_model": "deepseek/deepseek-v4-flash",
            "_generation_reasoning_effort": reasoning_effort,
            "_generation_fallback_model": "openai/gpt-5.4-mini",
            "_generation_fallback_reasoning_effort": "none",
        },
        settings,
    )

    assert primary_reasoning == reasoning_effort
    assert fallback_reasoning == "none"


@pytest.mark.parametrize("reasoning_effort", ["low", "medium"])
def test_resolve_generation_reasoning_efforts_rejects_deepseek_unsupported_values(reasoning_effort: str):
    settings = WorkerSettingsEnv(openrouter_api_key="test-key")

    with pytest.raises(RuntimeError, match="not supported by the generation model"):
        worker._resolve_generation_reasoning_efforts(
            {
                "_generation_model": "deepseek/deepseek-v4-flash",
                "_generation_reasoning_effort": reasoning_effort,
            },
            settings,
        )


def test_build_generation_failure_payload_includes_quota_period_start():
    payload = build_generation_failure_payload(
        application_id="app-1",
        user_id="user-1",
        job_id="job-1",
        message="Failed.",
        terminal_error_code="generation_failed",
        quota_period_start="2026-05-01",
    )

    assert payload["quota_period_start"] == "2026-05-01"

    payload_none = build_generation_failure_payload(
        application_id="app-1",
        user_id="user-1",
        job_id="job-1",
        message="Failed.",
        terminal_error_code="generation_failed",
        quota_period_start=None,
    )
    assert payload_none["quota_period_start"] is None


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


def test_detect_blocked_page_handles_none_final_url():
    context = PageContext(
        source_url=None,
        final_url=None,
        page_title="You have been blocked",
        meta={},
        json_ld=[],
        visible_text=(
            "You have been blocked. If you believe this in error, go to support.indeed.com. "
            "Your Ray ID for this request is 9e8afb060bd31117."
        ),
        detected_origin=None,
        extracted_reference_id="abc123",
    )

    blocked = detect_blocked_page(context)
    assert blocked is not None
    assert blocked.kind == "blocked_source"
    assert blocked.provider == "indeed"
    assert blocked.reference_id == "9e8afb060bd31117"
    assert blocked.blocked_url is None


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


def test_build_page_context_from_capture_allows_missing_job_url():
    capture = SourceCapture(
        source_text="Backend Engineer at Acme. Build APIs and queues.",
        page_title="Backend Engineer",
    )

    context = build_page_context_from_capture(None, capture)

    assert context.source_url is None
    assert context.final_url is None
    assert context.detected_origin is None
    assert context.extracted_reference_id is None
    assert context.visible_text == "Backend Engineer at Acme. Build APIs and queues."


def test_build_page_context_from_capture_preserves_longer_source_text_up_to_new_limit():
    long_text = "Qualifications\n" + ("Python APIs and distributed systems.\n" * 4000)
    capture = SourceCapture(source_text=long_text)

    context = build_page_context_from_capture("https://example.com/jobs/role", capture)

    assert len(context.visible_text) == EXTRACTION_TEXT_LIMIT
    assert context.visible_text.startswith("Qualifications")


def test_worker_settings_normalizes_generation_reasoning_effort():
    settings = WorkerSettingsEnv(generation_agent_reasoning_effort="HIGH")

    assert settings.generation_agent_reasoning_effort == "high"


def test_local_compose_forwards_generation_and_judge_reasoning_effort_envs():
    compose_text = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text()

    assert "GENERATION_AGENT_REASONING_EFFORT: ${GENERATION_AGENT_REASONING_EFFORT:-none}" in compose_text
    assert "RESUME_JUDGE_AGENT_REASONING_EFFORT: ${RESUME_JUDGE_AGENT_REASONING_EFFORT:-none}" in compose_text


def test_worker_settings_rejects_invalid_generation_reasoning_effort():
    with pytest.raises(ValueError, match="generation_agent_reasoning_effort must be one of"):
        WorkerSettingsEnv(generation_agent_reasoning_effort="turbo")


def test_worker_settings_rejects_duplicate_generation_fallback_model():
    with pytest.raises(ValueError, match="generation_agent_fallback_model must differ"):
        WorkerSettingsEnv(
            generation_agent_model="openai/gpt-5-mini",
            generation_agent_fallback_model="openai/gpt-5-mini",
        )


def test_worker_settings_normalizes_resume_judge_reasoning_effort():
    settings = WorkerSettingsEnv(resume_judge_agent_reasoning_effort="NONE")

    assert settings.resume_judge_agent_reasoning_effort == "none"


def test_worker_settings_rejects_duplicate_resume_judge_fallback_model():
    with pytest.raises(ValueError, match="resume_judge_agent_fallback_model must differ"):
        WorkerSettingsEnv(
            resume_judge_agent_model="google/gemini-3-flash-preview",
            resume_judge_agent_fallback_model="google/gemini-3-flash-preview",
        )


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
    result, model = await agent.extract(build_context())
    assert result.company == "Acme"
    assert result.job_location_text == "Toronto, ON"
    assert result.compensation_text == "$140,000 - $170,000"
    assert model == "fallback-model"
    assert agent.calls == ["primary-model", "fallback-model"]


def test_build_generation_success_payload_nests_generated_fields():
    payload = build_generation_success_payload(
        application_id="app-1",
        user_id="user-1",
        job_id="job-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
        attempts=[{"model": "primary", "outcome": "success"}],
        length_diagnostics={
            "target_length": "1_page",
            "generated_word_count": 430,
            "minimum_acceptable_words": 450,
            "source_limited_length": False,
        },
    )

    assert payload["event"] == "succeeded"
    assert payload["generated"]["content_md"] == "# Resume"
    assert payload["generated"]["generation_params"]["page_length"] == "1_page"
    assert payload["generated"]["generation_params"].get("attempts") is None
    assert payload["generated"]["attempts"] == [{"model": "primary", "outcome": "success"}]
    assert payload["generated"]["length_diagnostics"]["minimum_acceptable_words"] == 450


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


def test_stored_generation_settings_strips_private_model_fields():
    stored = worker._stored_generation_settings(
        {
            "page_length": "1_page",
            "aggressiveness": "medium",
            "_generation_model": "google/gemini-3-flash-preview",
            "_generation_reasoning_effort": "medium",
            "_generation_fallback_model": "openai/gpt-5.4-mini",
            "_generation_fallback_reasoning_effort": "high",
            "_base_resume_snapshot_content": "# Resume\n\nOld content",
            "_current_draft_snapshot_content": "# Resume\n\nCurrent content",
        },
        model_used="google/gemini-3-flash-preview",
    )

    assert stored["page_length"] == "1_page"
    assert stored["aggressiveness"] == "medium"
    assert stored["model_used"] == "google/gemini-3-flash-preview"
    assert "_generation_model" not in stored
    assert "_generation_reasoning_effort" not in stored
    assert "_generation_fallback_model" not in stored
    assert "_generation_fallback_reasoning_effort" not in stored
    assert "_base_resume_snapshot_content" not in stored
    assert "_current_draft_snapshot_content" not in stored


def test_quota_period_start_normalizes_blank_values():
    assert worker._quota_period_start({"quota_period_start": "2026-05-01"}) == "2026-05-01"
    assert worker._quota_period_start({"quota_period_start": "   "}) is None
    assert worker._quota_period_start({}) is None


@pytest.mark.asyncio
async def test_validate_generated_sections_with_repair_passes_through_insufficient_experience_tailoring():
    validation_calls = 0
    captured_validation_errors: list[object] = []

    async def fake_validate_resume(**_kwargs):
        nonlocal validation_calls
        validation_calls += 1
        if validation_calls == 1:
            return {
                "valid": False,
                "errors": [
                    {
                        "type": "insufficient_experience_tailoring",
                        "section": "professional_experience",
                        "detail": "Insufficient Professional Experience tailoring for high aggressiveness.",
                    }
                ],
            }
        return {"valid": True, "errors": []}

    async def fake_repair_generated_response(**kwargs):
        captured_validation_errors.extend(kwargs["validation_errors"])
        repaired_section = type(
            "GeneratedSection",
            (),
            {
                "id": "professional_experience",
                "heading": "Professional Experience",
                "content": {
                    "jobs": [
                        {
                            "source_role_index": 0,
                            "company": "Acme",
                            "location": None,
                            "title": "Platform Engineer",
                            "date_range": "2022 - Present",
                            "bullets": ["Built backend systems and maintained deployment tooling."],
                        }
                    ]
                },
                "supporting_snippets": ["Built backend systems.", "Maintained deployment tooling."],
            },
        )()
        repaired_payload = type("GeneratedPayload", (), {"sections": [repaired_section]})()
        return repaired_payload, "fallback-model", [{"transport_mode": "repair_json", "outcome": "success"}], None

    progress_updates: list[tuple[int, str]] = []

    async def on_progress(percent: int, message: str) -> None:
        progress_updates.append((percent, message))

    original_validate_resume = worker.validate_resume
    original_repair_generated_response = worker.repair_generated_response
    worker.validate_resume = fake_validate_resume
    worker.repair_generated_response = fake_repair_generated_response
    try:
        generated_sections, validation_result, attempts, failure_details = await worker._validate_generated_sections_with_repair(
            generated_sections=[
                {
                    "name": "professional_experience",
                    "heading": "Professional Experience",
                    "content": (
                        "## Professional Experience\n"
                        "Backend Engineer | Acme | 2022 - Present\n"
                        "- Built backend systems.\n"
                        "- Maintained deployment tooling."
                    ),
                    "supporting_snippets": ["Built backend systems.", "Maintained deployment tooling."],
                }
            ],
            base_resume_content=(
                "## Professional Experience\n"
                "Backend Engineer | Acme | 2022 - Present\n"
                "- Built backend systems.\n"
                "- Maintained deployment tooling.\n"
            ),
            section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
            generation_settings={"page_length": "1_page", "aggressiveness": "high"},
            professional_experience_anchors=[
                {
                    "role_index": 0,
                    "source_title": "Backend Engineer",
                    "source_company": "Acme",
                    "source_date_range": "2022 - Present",
                }
            ],
            prompt=[("system", "sys"), ("human", "{}")],
            section_ids=["professional_experience"],
            operation="generation",
            model="primary-model",
            fallback_model="fallback-model",
            model_used="primary-model",
            attempt_diagnostics=[{"model": "primary-model", "outcome": "success"}],
            api_key="test-key",
            base_url="https://example.com",
            repair_deadline=10.0,
            on_progress=on_progress,
        )
    finally:
        worker.validate_resume = original_validate_resume
        worker.repair_generated_response = original_repair_generated_response

    assert captured_validation_errors[0]["type"] == "insufficient_experience_tailoring"
    assert validation_result["valid"] is True
    assert failure_details is None
    assert generated_sections[0]["name"] == "professional_experience"
    assert attempts[-1]["transport_mode"] == "repair_json"
    assert progress_updates[-1] == (88, "Validation failed. Attempting one repair pass")


@pytest.mark.asyncio
async def test_validate_generated_sections_with_repair_uses_remaining_timeout_budget():
    captured_timeout: list[float] = []

    async def fake_validate_resume(**_kwargs):
        return {"valid": False, "errors": ["Wrong section order"]}

    async def fake_repair_generated_response(**kwargs):
        captured_timeout.append(kwargs["timeout"])
        return None, "fallback-model", [], asyncio.TimeoutError("No remaining timeout budget for validation repair.")

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    original_validate_resume = worker.validate_resume
    original_repair_generated_response = worker.repair_generated_response
    original_perf_counter = worker.perf_counter
    worker.validate_resume = fake_validate_resume
    worker.repair_generated_response = fake_repair_generated_response
    worker.perf_counter = lambda: 47.5
    try:
        _generated_sections, validation_result, _attempts, failure_details = await worker._validate_generated_sections_with_repair(
            generated_sections=[
                {
                    "name": "summary",
                    "heading": "Summary",
                    "content": "## Summary\nBuilt reliable APIs.",
                    "supporting_snippets": ["Built reliable APIs."],
                }
            ],
            base_resume_content="## Summary\nBuilt reliable APIs.\n",
            section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
            generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            professional_experience_anchors=[],
            prompt=[("system", "sys"), ("human", "{}")],
            section_ids=["summary"],
            operation="generation",
            model="primary-model",
            fallback_model="fallback-model",
            model_used="primary-model",
            attempt_diagnostics=[{"model": "primary-model", "outcome": "success"}],
            api_key="test-key",
            base_url="https://example.com",
            repair_deadline=50.0,
            on_progress=on_progress,
        )
    finally:
        worker.validate_resume = original_validate_resume
        worker.repair_generated_response = original_repair_generated_response
        worker.perf_counter = original_perf_counter

    assert validation_result["valid"] is False
    assert captured_timeout == [2.5]
    assert failure_details is not None
    assert failure_details["failure_stage"] == "repair"


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
            return FakeResponse(503 if attempts["count"] < 2 else 200)

    monkeypatch.setattr("worker.httpx.AsyncClient", FakeAsyncClient)

    settings = WorkerSettingsEnv(
        backend_api_url="https://backend.example",
        worker_callback_secret="secret",
    )
    client = BackendCallbackClient(settings)
    await client.post({"ok": True})

    assert attempts["count"] == 2


@pytest.mark.asyncio
async def test_backend_callback_client_falls_back_from_stale_railway_internal_port(monkeypatch):
    attempted_urls: list[str] = []

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url: str, *, json, headers):
            del json, headers
            attempted_urls.append(url)
            if url.startswith("http://backend.railway.internal:8000"):
                import httpx

                raise httpx.ConnectError("connection refused", request=httpx.Request("POST", url))
            return FakeResponse()

    monkeypatch.setattr("worker.httpx.AsyncClient", FakeAsyncClient)

    settings = WorkerSettingsEnv(
        backend_api_url="http://backend.railway.internal:8000",
        railway_service_backend_url="backend-production.example.up.railway.app",
        worker_callback_secret="secret",
    )
    client = BackendCallbackClient(settings)
    await client.post({"ok": True}, path="/api/internal/worker/resume-judge-callback")

    assert attempted_urls == [
        "http://backend.railway.internal:8000/api/internal/worker/resume-judge-callback",
        "http://backend.railway.internal:8080/api/internal/worker/resume-judge-callback",
    ]


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
        async def extract(self, context: PageContext) -> tuple[ExtractedJobPosting, str]:
            del context
            return ExtractedJobPosting(
                job_title="Senior Backend Engineer",
                job_description="Build APIs and background systems.",
                company="Acme",
                job_location_text="Toronto, ON",
                compensation_text="$140,000 - $170,000",
                job_posting_origin="linkedin",
                extracted_reference_id="1234567890",
            ), "google/gemini-3-flash-preview"

    fake_writer = FakeWriter()
    fake_callback = FakeCallback()

    monkeypatch.setattr("worker.WorkerSettingsEnv", lambda: WorkerSettingsEnv(redis_url="redis://unused"))
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: fake_callback)
    monkeypatch.setattr("worker.OpenRouterExtractionAgent", lambda _settings: FakeExtractor())
    monkeypatch.setattr(
        "worker.OpenRouterKeywordExtractionAgent",
        lambda _settings: pytest.fail("keyword extraction must not run inline during extraction"),
    )

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
    assert result["job_keywords"] is None
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
        async def extract(self, context: PageContext) -> tuple[ExtractedJobPosting, str]:
            del context
            return ExtractedJobPosting(
                job_title="Senior Backend Engineer",
                job_description="Build APIs and background systems.",
                company="Acme",
                job_location_text="Toronto, ON",
                compensation_text="$140,000 - $170,000",
                job_posting_origin="linkedin",
                extracted_reference_id="1234567890",
            ), "google/gemini-3-flash-preview"

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
        return build_generation_result()

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        return generated_sections, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

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
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)
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

    assert fake_callback.events == ["succeeded"]
    final_progress = await fake_writer.get("app-3")
    assert final_progress is not None
    assert final_progress.state == "resume_ready"
    assert fake_writer.generated_by_app["app-3"]["job_id"] == "job-3"


@pytest.mark.asyncio
async def test_run_generation_job_uses_job_supplied_tier_models(monkeypatch):
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
        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/generation-callback"):
            del payload, path

    observed_models: dict[str, str] = {}

    async def fake_generate_sections(**kwargs):
        observed_models["model"] = kwargs["model"]
        observed_models["fallback_model"] = kwargs["fallback_model"]
        observed_models["reasoning_effort"] = kwargs["reasoning_effort"]
        observed_models["fallback_reasoning_effort"] = kwargs["fallback_reasoning_effort"]
        return {
            **build_generation_result(),
            "model_used": "google/gemini-3-flash-preview",
            "attempt_diagnostics": [{"model": "google/gemini-3-flash-preview", "outcome": "success"}],
        }

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        return generated_sections, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

    fake_writer = FakeWriter()
    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="env-primary-model",
            generation_agent_fallback_model="env-fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: fake_writer)
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: FakeCallback())
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)
    monkeypatch.setattr("worker.assemble_resume", lambda **_kwargs: "# Test Resume")

    await run_generation_job(
        {},
        application_id="app-tier",
        user_id="user-tier",
        job_id="job-tier",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs",
        personal_info={"name": "User"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "subscription_tier": "basic",
            "quota_period_start": "2026-05-01",
            "_generation_model": "google/gemini-3-flash-preview",
            "_generation_reasoning_effort": "medium",
            "_generation_fallback_model": "openai/gpt-5.4-mini",
            "_generation_fallback_reasoning_effort": "high",
        },
    )

    generated = fake_writer.generated_by_app["app-tier"]["generated"]
    assert observed_models == {
        "model": "google/gemini-3-flash-preview",
        "fallback_model": "openai/gpt-5.4-mini",
        "reasoning_effort": "medium",
        "fallback_reasoning_effort": "high",
    }
    assert generated["generation_params"]["model_used"] == "google/gemini-3-flash-preview"
    assert "_generation_model" not in generated["generation_params"]
    assert "_generation_reasoning_effort" not in generated["generation_params"]
    assert "_generation_fallback_model" not in generated["generation_params"]
    assert "_generation_fallback_reasoning_effort" not in generated["generation_params"]
    assert "attempts" not in generated["generation_params"]
    assert generated["attempts"][0]["model"] == "google/gemini-3-flash-preview"


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
        def __init__(self) -> None:
            self.payloads: list[dict[str, object]] = []

        async def post(self, payload: dict[str, object], *, path: str = "/api/internal/worker/generation-callback"):
            del path
            self.payloads.append(payload)
            raise RuntimeError("backend unreachable")

    async def fake_generate_sections(**kwargs):
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(50, "Generating sections")
        return build_generation_result()

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        attempt_diagnostics = kwargs["attempt_diagnostics"]
        return (
            generated_sections,
            {"valid": False, "errors": ["Missing required section: skills"]},
            attempt_diagnostics,
            {
                "failure_stage": "validation",
                "attempt_count": len(attempt_diagnostics),
                "attempts": attempt_diagnostics,
                "terminal_error_code": "validation_failed",
            },
        )

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
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)

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
    failure_details = fake_callback.payloads[0]["failure"]["failure_details"]
    assert failure_details["failure_stage"] == "validation"
    assert failure_details["attempt_count"] == 1


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
        return build_generation_result()

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        return generated_sections, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

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
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)
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
    assert fake_callback.events == ["succeeded"]


@pytest.mark.asyncio
async def test_run_generation_job_uses_prd_full_timeout(monkeypatch):
    observed_timeouts: list[float] = []

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
            return None

    async def fake_generate_sections(**kwargs):
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(50, "Generating sections")
        return build_generation_result()

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        return generated_sections, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

    def fake_assemble_resume(**kwargs):
        del kwargs
        return "# Test Resume"

    async def fake_wait_for(awaitable, timeout):
        observed_timeouts.append(timeout)
        return await awaitable

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: FakeWriter())
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: FakeCallback())
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)
    monkeypatch.setattr("worker.assemble_resume", fake_assemble_resume)
    monkeypatch.setattr("worker.asyncio.wait_for", fake_wait_for)

    await run_generation_job(
        {},
        application_id="app-6",
        user_id="user-6",
        job_id="job-6",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs",
        personal_info={"name": "User"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
    )

    assert observed_timeouts == [FULL_GENERATION_MAX_TIMEOUT_SECONDS]


@pytest.mark.asyncio
async def test_run_resume_judge_job_posts_started_and_succeeded_callbacks(monkeypatch):
    callback_payloads: list[dict[str, object]] = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_judge_resume(**kwargs):
        assert kwargs["model"] == "judge-primary"
        assert kwargs["fallback_model"] == "judge-fallback"
        assert kwargs["reasoning_effort"] == "none"
        return {
            "resume_judge_result": {
                "status": "succeeded",
                "final_score": 84.3,
                "display_score": 84,
                "verdict": "pass",
                "pass_threshold": 80.0,
                "score_summary": "Strong draft.",
                "dimension_scores": {},
                "regeneration_instructions": None,
                "regeneration_priority_dimensions": [],
                "evaluator_notes": "Looks good.",
                "evaluated_draft_updated_at": kwargs["evaluated_draft_updated_at"],
                "scored_at": kwargs["scored_at"],
            },
            "model_used": "judge-primary",
            "attempt_diagnostics": [{"model": "judge-primary", "outcome": "success"}],
        }

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            openrouter_api_key="test-key",
            resume_judge_agent_model="judge-primary",
            resume_judge_agent_fallback_model="judge-fallback",
            resume_judge_agent_reasoning_effort="none",
        ),
    )
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.judge_resume", fake_judge_resume)

    await run_resume_judge_job(
        {},
        application_id="app-judge-1",
        user_id="user-judge-1",
        job_id="job-judge-1",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs.\n",
        generated_resume_content="# Resume",
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        evaluated_draft_updated_at="2026-04-07T12:10:00+00:00",
        job_context_signature="backend engineer\x1facme\x1fbuild apis",
        input_signature="sig-judge-1",
    )

    assert [payload["event"] for payload in callback_payloads] == ["started", "succeeded"]
    assert callback_payloads[0]["job_context_signature"] == "backend engineer\x1facme\x1fbuild apis"
    assert callback_payloads[0]["input_signature"] == "sig-judge-1"
    assert callback_payloads[-1]["result"]["job_context_signature"] == "backend engineer\x1facme\x1fbuild apis"
    assert callback_payloads[-1]["result"]["input_signature"] == "sig-judge-1"
    assert callback_payloads[-1]["result"]["display_score"] == 84


@pytest.mark.asyncio
async def test_run_resume_judge_job_posts_failure_payload_on_error(monkeypatch):
    callback_payloads: list[dict[str, object]] = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_judge_resume(**kwargs):
        del kwargs
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            openrouter_api_key="test-key",
            resume_judge_agent_model="judge-primary",
            resume_judge_agent_fallback_model="judge-fallback",
            resume_judge_agent_reasoning_effort="none",
        ),
    )
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.judge_resume", fake_judge_resume)

    with pytest.raises(RuntimeError, match="provider exploded"):
        await run_resume_judge_job(
            {},
            application_id="app-judge-2",
            user_id="user-judge-2",
            job_id="job-judge-2",
            job_title="Backend Engineer",
            company_name="Acme",
            job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs.\n",
        generated_resume_content="# Resume",
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            evaluated_draft_updated_at="2026-04-07T12:10:00+00:00",
            job_context_signature="backend engineer\x1facme\x1fbuild apis",
            input_signature="sig-judge-2",
        )

    assert [payload["event"] for payload in callback_payloads] == ["started", "failed"]
    failure_result = callback_payloads[-1]["failure"]["result"]
    assert failure_result["status"] == "failed"
    assert failure_result["job_context_signature"] == "backend engineer\x1facme\x1fbuild apis"
    assert failure_result["input_signature"] == "sig-judge-2"
    assert failure_result["error"]["error_type"] == "RuntimeError"


@pytest.mark.asyncio
async def test_run_regeneration_job_success(monkeypatch):
    from worker import run_regeneration_job

    callback_payloads = []
    observed_regen_kwargs: dict[str, object] = {}

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_regenerate_single_section(**kwargs):
        observed_regen_kwargs.update(kwargs)
        return {
            "content": "## Summary\nHighly direct quality engineer.",
            "model_used": "google/gemini-35-flash",
            "prompt": "Make it direct",
            "operation": "regeneration_section",
            "attempt_diagnostics": [{"model": "google/gemini-35-flash", "outcome": "success"}],
        }

    async def fake_validate_with_repair(**kwargs):
        regenerated_section = kwargs["regenerated_section"]
        return regenerated_section, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

    class FakeWriter:
        def __init__(self) -> None:
            self.progress = None
            self.generated = None

        async def get(self, application_id: str):
            return None

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            self.progress = progress

        async def clear_generation_result(self, application_id: str) -> None:
            pass

        async def set_generation_result(
            self,
            application_id: str,
            *,
            job_id: str,
            workflow_kind: str,
            generated: dict[str, object],
            ttl_seconds: int = 86400,
        ) -> None:
            self.generated = generated

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
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.regenerate_single_section", fake_regenerate_single_section)
    monkeypatch.setattr("worker._validate_regenerated_section_with_repair", fake_validate_with_repair)

    section_prefs = [
        {"name": "summary", "enabled": True, "order": 0},
        {"name": "experience", "enabled": True, "order": 1},
    ]

    await run_regeneration_job(
        {},
        application_id="app-regen-test",
        user_id="user-regen-test",
        job_id="job-regen-test",
        current_draft_content="## Summary\nOld Summary\n## Experience\nOld Experience",
        job_title="Quality Engineer",
        company_name="Acme",
        job_description="Quality control and analysis",
        base_resume_content="## Summary\nOld Summary\n## Experience\nOld Experience",
        personal_info={"name": "Sankal"},
        section_preferences=section_prefs,
        generation_settings={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "_generation_model": "google/gemini-3-flash-preview",
            "_generation_reasoning_effort": "medium",
            "_generation_fallback_model": "openai/gpt-5.4-mini",
            "_generation_fallback_reasoning_effort": "high",
        },
        regeneration_target="summary",
        regeneration_instructions="Make the summary more direct.",
    )

    assert observed_regen_kwargs["model"] == "google/gemini-3-flash-preview"
    assert observed_regen_kwargs["fallback_model"] == "openai/gpt-5.4-mini"
    assert observed_regen_kwargs["reasoning_effort"] == "medium"
    assert observed_regen_kwargs["fallback_reasoning_effort"] == "high"
    assert len(callback_payloads) == 1
    success_payload = callback_payloads[0]
    assert success_payload["event"] == "succeeded"
    assert success_payload["regeneration_target"] == "summary"
    assert success_payload["generated"]["sections_snapshot"] == {
        "enabled_sections": ["summary", "experience"],
        "section_order": ["summary", "experience"],
    }
    generation_params = success_payload["generated"]["generation_params"]
    assert generation_params["model_used"] == "google/gemini-35-flash"
    assert "_generation_model" not in generation_params
    assert "_generation_reasoning_effort" not in generation_params
    assert "_generation_fallback_model" not in generation_params
    assert "_generation_fallback_reasoning_effort" not in generation_params
    assert "attempts" not in generation_params
    assert success_payload["generated"]["attempts"][0]["model"] == "google/gemini-35-flash"


@pytest.mark.asyncio
async def test_run_regeneration_job_full_success(monkeypatch):
    from worker import run_regeneration_job

    callback_payloads = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_generate_sections(**kwargs):
        return {
            "sections": [
                {
                    "name": "summary",
                    "heading": "Summary",
                    "content": "## Summary\nRefreshed summary.",
                    "supporting_snippets": [],
                }
            ],
            "model_used": "google/gemini-3-flash-preview",
            "attempt_diagnostics": [{"model": "google/gemini-3-flash-preview", "outcome": "success"}],
            "prompt": [("system", "sys"), ("human", "{}")],
            "section_ids": ["summary"],
            "operation": "regeneration_full",
            "professional_experience_anchors": [],
        }

    async def fake_validate_with_repair(**kwargs):
        generated_sections = kwargs["generated_sections"]
        return generated_sections, {"valid": True, "errors": []}, kwargs["attempt_diagnostics"], None

    def fake_assemble_resume(**kwargs):
        del kwargs
        return "# Resume\n\n## Summary\nRefreshed summary."

    class FakeWriter:
        async def get(self, application_id: str):
            del application_id
            return None

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del application_id, progress, ttl_seconds

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id

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

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: FakeWriter())
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.generate_sections", fake_generate_sections)
    monkeypatch.setattr("worker._validate_generated_sections_with_repair", fake_validate_with_repair)
    monkeypatch.setattr("worker.assemble_resume", fake_assemble_resume)

    await run_regeneration_job(
        {},
        application_id="app-regen-full",
        user_id="user-regen-full",
        job_id="job-regen-full",
        job_title="Quality Engineer",
        company_name="Acme",
        job_description="Quality control and analysis",
        base_resume_content="## Summary\nOld Summary",
        personal_info={"name": "Sankal"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        regeneration_target="full",
    )

    assert len(callback_payloads) == 1
    success_payload = callback_payloads[0]
    assert success_payload["event"] == "succeeded"
    assert success_payload["regeneration_target"] == "full"
    assert success_payload["generated"]["sections_snapshot"] == {
        "enabled_sections": ["summary"],
        "section_order": ["summary"],
    }


@pytest.mark.asyncio
async def test_run_regeneration_job_validation_failure_includes_regeneration_target(monkeypatch):
    from worker import run_regeneration_job

    callback_payloads = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_regenerate_single_section(**kwargs):
        return {
            "name": "summary",
            "heading": "Summary",
            "content": "## Summary\nDraft.",
            "supporting_snippets": [],
            "model_used": "google/gemini-35-flash",
            "prompt": "Make it direct",
            "operation": "regeneration_section",
            "attempt_diagnostics": [{"model": "google/gemini-35-flash", "outcome": "success"}],
        }

    async def fake_validate_with_repair(**kwargs):
        regenerated_section = kwargs["regenerated_section"]
        return (
            regenerated_section,
            {"valid": False, "errors": ["Missing required section: summary"]},
            kwargs["attempt_diagnostics"],
            None,
        )

    class FakeWriter:
        async def get(self, application_id: str):
            del application_id
            return None

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del application_id, progress, ttl_seconds

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id

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

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: FakeWriter())
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.regenerate_single_section", fake_regenerate_single_section)
    monkeypatch.setattr("worker._validate_regenerated_section_with_repair", fake_validate_with_repair)

    await run_regeneration_job(
        {},
        application_id="app-regen-fail-validation",
        user_id="user-regen-fail-validation",
        job_id="job-regen-fail-validation",
        current_draft_content="## Summary\nOld Summary",
        job_title="Quality Engineer",
        company_name="Acme",
        job_description="Quality control and analysis",
        base_resume_content="## Summary\nOld Summary",
        personal_info={"name": "Sankal"},
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        regeneration_target="summary",
        regeneration_instructions="Make the summary more direct.",
    )

    assert len(callback_payloads) == 1
    failure_payload = callback_payloads[0]
    assert failure_payload["event"] == "failed"
    assert failure_payload["regeneration_target"] == "summary"
    assert failure_payload["failure"]["terminal_error_code"] == "validation_failed"
    assert failure_payload["failure"]["failure_details"]["validation_errors"] == ["Missing required section: summary"]


@pytest.mark.asyncio
async def test_run_regeneration_job_timeout_includes_regeneration_target(monkeypatch):
    from worker import run_regeneration_job

    callback_payloads = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_wait_for(awaitable, timeout):
        del timeout
        awaitable.close()
        raise asyncio.TimeoutError()

    class FakeWriter:
        async def get(self, application_id: str):
            del application_id
            return None

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del application_id, progress, ttl_seconds

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id

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

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: FakeWriter())
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.asyncio.wait_for", fake_wait_for)

    with pytest.raises(asyncio.TimeoutError):
        await run_regeneration_job(
            {},
            application_id="app-regen-timeout",
            user_id="user-regen-timeout",
            job_id="job-regen-timeout",
            current_draft_content="## Summary\nOld Summary",
            job_title="Quality Engineer",
            company_name="Acme",
            job_description="Quality control and analysis",
            base_resume_content="## Summary\nOld Summary",
            personal_info={"name": "Sankal"},
            section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
            generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            regeneration_target="summary",
            regeneration_instructions="Make the summary more direct.",
        )

    assert len(callback_payloads) == 1
    failure_payload = callback_payloads[0]
    assert failure_payload["event"] == "failed"
    assert failure_payload["regeneration_target"] == "summary"
    assert failure_payload["failure"]["terminal_error_code"] == "regeneration_timeout"


@pytest.mark.asyncio
async def test_run_regeneration_job_error_includes_regeneration_target(monkeypatch):
    from worker import run_regeneration_job

    callback_payloads = []

    async def fake_post_callback_best_effort(callback, payload, *, path: str, app_id: str, job_id: str, callback_stage: str):
        del callback, path, app_id, job_id, callback_stage
        callback_payloads.append(payload)

    async def fake_regenerate_single_section(**kwargs):
        del kwargs
        raise RuntimeError("provider exploded")

    class FakeWriter:
        async def get(self, application_id: str):
            del application_id
            return None

        async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400):
            del application_id, progress, ttl_seconds

        async def clear_generation_result(self, application_id: str) -> None:
            del application_id

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

    monkeypatch.setattr(
        "worker.WorkerSettingsEnv",
        lambda: WorkerSettingsEnv(
            redis_url="redis://unused",
            openrouter_api_key="test-key",
            generation_agent_model="primary-model",
            generation_agent_fallback_model="fallback-model",
        ),
    )
    monkeypatch.setattr("worker.RedisProgressWriter", lambda _redis_url: FakeWriter())
    monkeypatch.setattr("worker.BackendCallbackClient", lambda _settings: object())
    monkeypatch.setattr("worker.post_callback_best_effort", fake_post_callback_best_effort)
    monkeypatch.setattr("worker.regenerate_single_section", fake_regenerate_single_section)

    with pytest.raises(RuntimeError, match="provider exploded"):
        await run_regeneration_job(
            {},
            application_id="app-regen-error",
            user_id="user-regen-error",
            job_id="job-regen-error",
            current_draft_content="## Summary\nOld Summary",
            job_title="Quality Engineer",
            company_name="Acme",
            job_description="Quality control and analysis",
            base_resume_content="## Summary\nOld Summary",
            personal_info={"name": "Sankal"},
            section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
            generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            regeneration_target="summary",
            regeneration_instructions="Make the summary more direct.",
        )

    assert len(callback_payloads) == 1
    failure_payload = callback_payloads[0]
    assert failure_payload["event"] == "failed"
    assert failure_payload["regeneration_target"] == "summary"
    assert failure_payload["failure"]["terminal_error_code"] == "regeneration_error"
    assert failure_payload["failure"]["failure_details"]["error"]["error_type"] == "RuntimeError"


def test_worker_settings_disable_whole_job_generation_retries():
    from worker import WorkerSettings

    assert WorkerSettings.max_tries == 1
