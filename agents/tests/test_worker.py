from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker import (
    ExtractedJobPosting,
    OpenRouterExtractionAgent,
    PageContext,
    SourceCapture,
    WorkerSettingsEnv,
    build_page_context_from_capture,
    detect_blocked_page,
    extract_reference_id,
    finalize_extracted_posting,
    normalize_origin_from_url,
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
        job_posting_origin=None,
        job_posting_origin_other_text=None,
        extracted_reference_id=None,
    )
    finalized = finalize_extracted_posting(posting, build_context())
    assert finalized.job_posting_origin == "linkedin"
    assert finalized.extracted_reference_id == "1234567890"


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
            job_posting_origin="company_website",
            extracted_reference_id="REQ-42",
        )


@pytest.mark.asyncio
async def test_extraction_agent_uses_fallback_model_after_primary_failure():
    agent = FakeExtractionAgent()
    result = await agent.extract(build_context())
    assert result.company == "Acme"
    assert agent.calls == ["primary-model", "fallback-model"]
