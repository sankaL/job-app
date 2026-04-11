from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from arq.connections import RedisSettings
from langchain_openai import ChatOpenAI
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis

from assembly import assemble_resume
from generation import SECTION_DISPLAY_NAMES, _replace_section_in_draft, generate_sections, regenerate_single_section
from validation import validate_resume

logger = logging.getLogger(__name__)

CALLBACK_REQUEST_TIMEOUT_SECONDS = 8.0
CALLBACK_RETRY_ATTEMPTS = 6
CALLBACK_RETRY_INITIAL_BACKOFF_SECONDS = 1.0
CALLBACK_RETRY_MAX_BACKOFF_SECONDS = 8.0

ORIGIN_MAP = {
    "linkedin.com": "linkedin",
    "indeed.com": "indeed",
    "google.com": "google_jobs",
    "glassdoor.com": "glassdoor",
    "ziprecruiter.com": "ziprecruiter",
    "monster.com": "monster",
    "dice.com": "dice",
}
REFERENCE_QUERY_KEYS = {
    "jobid",
    "job_id",
    "currentjobid",
    "gh_jid",
    "jk",
    "reqid",
    "requisitionid",
}
REFERENCE_PATTERNS = (
    re.compile(
        r"(?:job(?:_|-|\s)?id|req(?:uisition)?(?:_|-|\s)?id|gh_jid|jk)[=: /-]*([A-Za-z0-9_-]{4,})",
        re.I,
    ),
    re.compile(r"/jobs/(?:view/)?([0-9]{4,})", re.I),
    re.compile(r"/job/([A-Za-z0-9_-]{6,})", re.I),
)
FULL_GENERATION_MAX_TIMEOUT_SECONDS = 540.0
SECTION_REGENERATION_TIMEOUT_SECONDS = 280.0
EXTRACTION_TEXT_LIMIT = 40_000
EXTRACTION_BLOCKED_PAGE_SCAN_LIMIT = 8_000


class WorkerSettingsEnv(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_dev_mode: bool = False
    redis_url: str = "redis://localhost:6379/0"
    backend_api_url: str = "http://backend:8000"
    worker_callback_secret: Optional[str] = None
    shared_contract_path: str = "/workspace/shared/workflow-contract.json"
    openrouter_api_key: Optional[str] = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    extraction_agent_model: Optional[str] = None
    extraction_agent_fallback_model: Optional[str] = None
    generation_agent_model: Optional[str] = None
    generation_agent_fallback_model: Optional[str] = None
    validation_agent_model: Optional[str] = None
    validation_agent_fallback_model: Optional[str] = None


class JobProgress(BaseModel):
    job_id: str
    workflow_kind: str
    state: str
    message: str
    percent_complete: int
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None
    terminal_error_code: Optional[str] = None


class PageContext(BaseModel):
    source_url: str
    final_url: str
    page_title: str
    meta: dict[str, str]
    json_ld: list[str]
    visible_text: str
    detected_origin: Optional[str]
    extracted_reference_id: Optional[str]


class SourceCapture(BaseModel):
    source_text: str
    source_url: Optional[str] = None
    page_title: Optional[str] = None
    meta: dict[str, str] = Field(default_factory=dict)
    json_ld: list[str] = Field(default_factory=list)
    captured_at: Optional[str] = None

    @field_validator("source_text")
    @classmethod
    def require_source_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Source text cannot be blank.")
        return stripped


class ExtractionFailureDetails(BaseModel):
    kind: str
    provider: Optional[str] = None
    reference_id: Optional[str] = None
    blocked_url: Optional[str] = None
    detected_at: str


class ExtractedJobPosting(BaseModel):
    job_title: str = Field(description="Required non-empty job title.")
    job_description: str = Field(
        description="Required non-empty full primary job posting text, including responsibilities, qualifications, compensation, and other role details when present.",
    )
    company: Optional[str] = Field(default=None, description="Optional company name.")
    job_location_text: Optional[str] = Field(
        default=None,
        description="Optional raw location text copied from the posting when clearly present.",
    )
    compensation_text: Optional[str] = Field(
        default=None,
        description="Optional raw salary or compensation text copied from the posting when clearly present.",
    )
    job_posting_origin: Optional[str] = Field(
        default=None,
        description=(
            "Optional normalized source: linkedin, indeed, google_jobs, glassdoor, "
            "ziprecruiter, monster, dice, company_website, or other."
        ),
    )
    job_posting_origin_other_text: Optional[str] = Field(
        default=None,
        description="Only set when job_posting_origin is other.",
    )
    extracted_reference_id: Optional[str] = Field(
        default=None,
        description="Optional reference id or requisition id from the posting.",
    )

    @field_validator("job_title", "job_description")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("company", "job_location_text", "compensation_text", "job_posting_origin_other_text", "extracted_reference_id")
    @classmethod
    def normalize_optional_value(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_validation_error(error: Any) -> Optional[str]:
    if isinstance(error, str):
        stripped = error.strip()
        return stripped or None

    if isinstance(error, dict):
        detail = str(error.get("detail") or error.get("type") or "").strip()
        section = str(error.get("section") or "").strip()
        if not detail:
            return None
        return f"{section}: {detail}" if section else detail

    text = str(error).strip()
    return text or None


def build_generation_success_payload(
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    content_md: str,
    generation_params: dict[str, Any],
    sections_snapshot: dict[str, Any],
) -> dict[str, Any]:
    return {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "succeeded",
        "generated": {
            "content_md": content_md,
            "generation_params": generation_params,
            "sections_snapshot": sections_snapshot,
        },
    }


def build_generation_failure_payload(
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    message: str,
    terminal_error_code: str,
    validation_errors: Optional[list[Any]] = None,
) -> dict[str, Any]:
    failure_details: dict[str, Any] = {}
    if validation_errors:
        normalized = [
            formatted
            for formatted in (_normalize_validation_error(error) for error in validation_errors)
            if formatted
        ]
        if normalized:
            failure_details["validation_errors"] = normalized

    return {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "failed",
        "failure": {
            "message": message,
            "terminal_error_code": terminal_error_code,
            "failure_details": failure_details or None,
        },
    }


def normalize_origin_from_url(url: str) -> Optional[str]:
    hostname = urlparse(url).hostname or ""
    hostname = hostname.lower()
    for domain, origin in ORIGIN_MAP.items():
        if domain == "google.com":
            if hostname.endswith("google.com") and "/search" in url:
                return origin
            continue
        if hostname.endswith(domain):
            return origin
    if hostname and not any(hostname.endswith(domain) for domain in ORIGIN_MAP):
        return "company_website"
    return None


def extract_reference_id(*values: Optional[str]) -> Optional[str]:
    for value in values:
        if not value:
            continue

        try:
            parsed = urlparse(value)
            for key, entries in parse_qs(parsed.query).items():
                if key.lower() in REFERENCE_QUERY_KEYS and entries:
                    candidate = entries[0].strip()
                    if candidate:
                        return candidate.lower()
        except ValueError:
            pass

        for pattern in REFERENCE_PATTERNS:
            match = pattern.search(value)
            if match:
                return match.group(1).lower()
    return None


def detect_blocked_page(context: PageContext) -> Optional[ExtractionFailureDetails]:
    combined = " ".join(
        [
            context.page_title,
            context.final_url,
            " ".join(f"{key} {value}" for key, value in context.meta.items()),
            context.visible_text[:EXTRACTION_BLOCKED_PAGE_SCAN_LIMIT],
        ]
    ).lower()

    provider: Optional[str] = None
    if "support.indeed.com" in combined or ("indeed" in combined and "you have been blocked" in combined):
        provider = "indeed"
    elif "cloudflare" in combined or "ray id" in combined or "cf-chl" in combined:
        provider = "cloudflare"

    blocked_markers = (
        "you have been blocked",
        "access denied",
        "ray id",
        "checking your browser",
        "verify you are human",
        "cf-chl",
    )
    if not provider and not any(marker in combined for marker in blocked_markers):
        return None

    reference_id = None
    ray_match = re.search(r"ray id(?: for this request is)?[: ]+([a-z0-9]+)", combined, re.I)
    if ray_match:
        reference_id = ray_match.group(1).lower()

    return ExtractionFailureDetails(
        kind="blocked_source",
        provider=provider or context.detected_origin or "unknown",
        reference_id=reference_id,
        blocked_url=context.final_url,
        detected_at=now_iso(),
    )


def load_workflow_contract() -> dict[str, Any]:
    settings = WorkerSettingsEnv()
    contract_path = Path(settings.shared_contract_path)
    if not contract_path.exists():
        contract_path = Path(__file__).resolve().parents[1] / "shared" / "workflow-contract.json"
    return json.loads(contract_path.read_text())


def build_progress(
    *,
    job_id: str,
    workflow_kind: str = "extraction",
    state: str,
    message: str,
    percent_complete: int,
    created_at: Optional[str] = None,
    completed_at: Optional[str] = None,
    terminal_error_code: Optional[str] = None,
) -> JobProgress:
    return JobProgress(
        job_id=job_id,
        workflow_kind=workflow_kind,
        state=state,
        message=message,
        percent_complete=percent_complete,
        created_at=created_at or now_iso(),
        updated_at=now_iso(),
        completed_at=completed_at,
        terminal_error_code=terminal_error_code,
    )


class RedisProgressWriter:
    def __init__(self, redis_url: str) -> None:
        self._redis = Redis.from_url(redis_url, encoding="utf-8", decode_responses=True)

    @staticmethod
    def _key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:progress"

    @staticmethod
    def _extraction_result_key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:extracted"

    @staticmethod
    def _generation_result_key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:generated"

    async def get(self, application_id: str) -> Optional[JobProgress]:
        payload = await self._redis.get(self._key(application_id))
        if payload is None:
            return None
        return JobProgress.model_validate(json.loads(payload))

    async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400) -> None:
        await self._redis.set(self._key(application_id), progress.model_dump_json(), ex=ttl_seconds)

    async def set_extracted_result(
        self,
        application_id: str,
        *,
        job_id: str,
        extracted: dict[str, Any],
        ttl_seconds: int = 86400,
    ) -> None:
        payload = {
            "job_id": job_id,
            "extracted": extracted,
            "captured_at": now_iso(),
        }
        await self._redis.set(self._extraction_result_key(application_id), json.dumps(payload), ex=ttl_seconds)

    async def clear_extracted_result(self, application_id: str) -> None:
        await self._redis.delete(self._extraction_result_key(application_id))

    async def set_generation_result(
        self,
        application_id: str,
        *,
        job_id: str,
        workflow_kind: str,
        generated: dict[str, Any],
        ttl_seconds: int = 86400,
    ) -> None:
        payload = {
            "job_id": job_id,
            "workflow_kind": workflow_kind,
            "generated": generated,
            "captured_at": now_iso(),
        }
        await self._redis.set(self._generation_result_key(application_id), json.dumps(payload), ex=ttl_seconds)

    async def clear_generation_result(self, application_id: str) -> None:
        await self._redis.delete(self._generation_result_key(application_id))


class BackendCallbackClient:
    def __init__(self, settings: WorkerSettingsEnv) -> None:
        self._settings = settings

    async def post(self, payload: dict[str, Any], *, path: str = "/api/internal/worker/extraction-callback") -> None:
        if not self._settings.worker_callback_secret:
            raise RuntimeError("WORKER_CALLBACK_SECRET is not configured.")
        last_error: Optional[Exception] = None
        for attempt in range(CALLBACK_RETRY_ATTEMPTS):
            try:
                async with httpx.AsyncClient(timeout=CALLBACK_REQUEST_TIMEOUT_SECONDS) as client:
                    response = await client.post(
                        f"{self._settings.backend_api_url.rstrip('/')}{path}",
                        json=payload,
                        headers={"X-Worker-Secret": self._settings.worker_callback_secret},
                    )
                    response.raise_for_status()
                    return
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if 400 <= exc.response.status_code < 500:
                    raise
            except httpx.HTTPError as exc:
                last_error = exc

            if attempt < CALLBACK_RETRY_ATTEMPTS - 1:
                await asyncio.sleep(
                    min(
                        CALLBACK_RETRY_INITIAL_BACKOFF_SECONDS * (2**attempt),
                        CALLBACK_RETRY_MAX_BACKOFF_SECONDS,
                    )
                )

        raise RuntimeError("Worker callback failed after retries.") from last_error


class OpenRouterExtractionAgent:
    def __init__(self, settings: WorkerSettingsEnv) -> None:
        self._settings = settings

    async def extract(self, context: PageContext) -> ExtractedJobPosting:
        if not self._settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not configured.")
        if not self._settings.extraction_agent_model:
            raise RuntimeError("EXTRACTION_AGENT_MODEL is not configured.")
        if not self._settings.extraction_agent_fallback_model:
            raise RuntimeError("EXTRACTION_AGENT_FALLBACK_MODEL is not configured.")

        last_error: Optional[Exception] = None
        for model_name in (
            self._settings.extraction_agent_model,
            self._settings.extraction_agent_fallback_model,
        ):
            try:
                return await self._extract_with_model(model_name, context)
            except Exception as error:
                last_error = error
        raise RuntimeError("Extraction agent failed on both primary and fallback models.") from last_error

    async def _extract_with_model(
        self,
        model_name: str,
        context: PageContext,
    ) -> ExtractedJobPosting:
        llm = ChatOpenAI(
            model=model_name,
            api_key=self._settings.openrouter_api_key,
            base_url=self._settings.openrouter_base_url,
            temperature=0,
            max_retries=0,
        ).with_structured_output(ExtractedJobPosting)

        prompt = [
            (
                "system",
                (
                    "Extract structured job-posting fields from the supplied webpage context.\n"
                    "Rules:\n"
                    "- Do not invent facts. job_title and job_description are required.\n"
                    "- Use json_ld for structured metadata when it is coherent.\n"
                    "- Use visible_text for the full primary job posting body, not just the responsibilities excerpt.\n"
                    "- job_description must include the complete posting content for the primary role when present: responsibilities, qualifications, requirements, benefits, compensation, and any other role-specific sections.\n"
                    "- Set job_location_text to the raw location text when the posting clearly states where the role can be hired, worked, or based.\n"
                    "- Keep compensation text inside job_description when it appears in the posting.\n"
                    "- Separate job_location_text and compensation_text even when they appear on the same line, in the same table, or in the same paragraph.\n"
                    "- Use meaning, labels, and surrounding context to decide what belongs to location versus compensation. Do not rely on brittle line-splitting assumptions.\n"
                    "- If the posting includes both a hiring region and a separate office list, prefer the most role-specific location text and keep it concise.\n"
                    "- If location is absent or ambiguous, leave job_location_text null.\n"
                    "- Also set compensation_text to the raw salary or compensation snippet when it is clearly stated. If compensation is absent or ambiguous, leave compensation_text null.\n"
                    "- Use page_title, meta, final_url, detected_origin, and extracted_reference_id only to disambiguate or fill structured fields already supported by the page.\n"
                    "- Ignore navigation, sign-in prompts, cookie banners, related-job cards, footers, and other page chrome.\n"
                    "- If multiple jobs are present, extract the primary posting that best matches the page title, URL, and reference id.\n"
                    "- Use only these normalized origins when known: linkedin, indeed, google_jobs, glassdoor, ziprecruiter, monster, dice, company_website, other.\n"
                    "- If origin is unknown, leave it null.\n"
                    "- If a field is uncertain, leave it null rather than guessing."
                ),
            ),
            (
                "human",
                json.dumps(
                    {
                        "source_url": context.source_url,
                        "final_url": context.final_url,
                        "page_title": context.page_title,
                        "meta": context.meta,
                        "json_ld": context.json_ld,
                        "visible_text": context.visible_text,
                        "detected_origin": context.detected_origin,
                        "extracted_reference_id": context.extracted_reference_id,
                    }
                ),
            ),
        ]
        return await llm.ainvoke(prompt)


async def scrape_page_context(job_url: str) -> PageContext:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_load_state("networkidle", timeout=10_000)
            page_title = await page.title()
            final_url = page.url
            visible_text = await _extract_primary_visible_text(page)
            meta_pairs = await page.locator("meta").evaluate_all(
                """
                (nodes) => nodes
                  .map((node) => ({
                    key: node.getAttribute('property') || node.getAttribute('name'),
                    value: node.getAttribute('content'),
                  }))
                  .filter((entry) => entry.key && entry.value)
                """
            )
            json_ld_entries = await page.locator("script[type='application/ld+json']").evaluate_all(
                "(nodes) => nodes.map((node) => node.textContent || '').filter(Boolean)"
            )
        finally:
            await browser.close()

    meta = {entry["key"]: entry["value"] for entry in meta_pairs[:50]}
    reference_id = extract_reference_id(final_url, visible_text)
    return PageContext(
        source_url=job_url,
        final_url=final_url,
        page_title=page_title or "",
        meta=meta,
        json_ld=json_ld_entries[:10],
        visible_text=visible_text[:EXTRACTION_TEXT_LIMIT],
        detected_origin=normalize_origin_from_url(final_url),
        extracted_reference_id=reference_id,
    )


def build_page_context_from_capture(job_url: str, capture: SourceCapture) -> PageContext:
    final_url = capture.source_url or job_url
    reference_id = extract_reference_id(final_url, capture.source_text)
    return PageContext(
        source_url=job_url,
        final_url=final_url,
        page_title=(capture.page_title or "").strip(),
        meta=dict(list(capture.meta.items())[:50]),
        json_ld=capture.json_ld[:10],
        visible_text=capture.source_text[:EXTRACTION_TEXT_LIMIT],
        detected_origin=normalize_origin_from_url(final_url),
        extracted_reference_id=reference_id,
    )


def finalize_extracted_posting(
    extracted: ExtractedJobPosting,
    context: PageContext,
) -> ExtractedJobPosting:
    origin = extracted.job_posting_origin or context.detected_origin
    other_text = extracted.job_posting_origin_other_text
    if origin != "other":
        other_text = None
    if origin == "other" and not other_text:
        origin = None

    return ExtractedJobPosting(
        job_title=extracted.job_title,
        job_description=extracted.job_description,
        company=extracted.company,
        job_location_text=extracted.job_location_text,
        compensation_text=extracted.compensation_text,
        job_posting_origin=origin,
        job_posting_origin_other_text=other_text,
        extracted_reference_id=extracted.extracted_reference_id or context.extracted_reference_id,
    )


async def _extract_primary_visible_text(page) -> str:
    selectors = ("main", "article", "[role='main']", "body")
    best_text = ""

    for selector in selectors:
        try:
            text = await page.locator(selector).first.inner_text(timeout=5_000)
        except Exception:
            continue
        normalized = text.strip()
        if not normalized:
            continue
        if len(normalized) > len(best_text):
            best_text = normalized
        if selector != "body" and len(normalized) >= 500:
            return normalized

    return best_text


async def set_progress(
    writer: RedisProgressWriter,
    application_id: str,
    *,
    job_id: str,
    workflow_kind: str = "extraction",
    state: str,
    message: str,
    percent_complete: int,
    completed_at: Optional[str] = None,
    terminal_error_code: Optional[str] = None,
) -> JobProgress:
    existing = await writer.get(application_id)
    if existing is not None and existing.job_id != job_id:
        return existing
    progress = build_progress(
        job_id=job_id,
        workflow_kind=workflow_kind,
        state=state,
        message=message,
        percent_complete=percent_complete,
        created_at=existing.created_at if existing and existing.job_id == job_id else None,
        completed_at=completed_at,
        terminal_error_code=terminal_error_code,
    )
    await writer.set(application_id, progress)
    return progress


async def is_current_job(
    writer: RedisProgressWriter,
    application_id: str,
    job_id: str,
) -> bool:
    existing = await writer.get(application_id)
    return existing is None or existing.job_id == job_id


async def report_failure(
    *,
    writer: RedisProgressWriter,
    callback: BackendCallbackClient,
    application_id: str,
    user_id: str,
    job_id: str,
    message: str,
    terminal_error_code: str,
    failure_details: Optional[ExtractionFailureDetails] = None,
) -> None:
    completed_at = now_iso()
    await set_progress(
        writer,
        application_id,
        job_id=job_id,
        state="manual_entry_required",
        message=message,
        percent_complete=100,
        completed_at=completed_at,
        terminal_error_code=terminal_error_code,
    )
    await writer.clear_extracted_result(application_id)
    await post_callback_best_effort(
        callback,
        {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "failed",
            "failure": {
                "message": message,
                "terminal_error_code": terminal_error_code,
                "failure_details": failure_details.model_dump() if failure_details else None,
            },
        },
        path="/api/internal/worker/extraction-callback",
        app_id=application_id,
        job_id=job_id,
        callback_stage="extraction failed",
    )


async def post_callback_best_effort(
    callback: BackendCallbackClient,
    payload: dict[str, Any],
    *,
    path: str,
    app_id: str,
    job_id: str,
    callback_stage: str,
) -> None:
    try:
        await callback.post(payload, path=path)
    except Exception as error:
        logger.warning(
            "Worker %s callback delivery failed; relying on progress/cache reconciliation. app_id=%s job_id=%s error=%s",
            callback_stage,
            app_id,
            job_id,
            error,
        )


async def set_generation_result_best_effort(
    writer: RedisProgressWriter,
    *,
    application_id: str,
    job_id: str,
    workflow_kind: str,
    generated: dict[str, Any],
) -> None:
    try:
        await writer.set_generation_result(
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            generated=generated,
        )
    except Exception as error:
        logger.warning(
            "Worker generation cache write failed; continuing without cached recovery payload. app_id=%s job_id=%s workflow_kind=%s error=%s",
            application_id,
            job_id,
            workflow_kind,
            error,
        )


async def report_bootstrap_progress(ctx: dict[str, Any]) -> dict[str, Any]:
    contract = load_workflow_contract()
    progress = JobProgress(
        job_id="phase-0-bootstrap",
        workflow_kind=contract["workflow_kinds"][0],
        state=contract["internal_states"][0],
        message="Worker baseline is online and ready for extraction jobs.",
        percent_complete=5,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    return asdict(progress)


async def run_extraction_job(
    ctx: dict[str, Any],
    *,
    application_id: str,
    user_id: str,
    job_url: str,
    job_id: str,
    source_capture: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    settings = WorkerSettingsEnv()
    writer = RedisProgressWriter(settings.redis_url)
    callback = BackendCallbackClient(settings)
    extractor = OpenRouterExtractionAgent(settings)

    await set_progress(
        writer,
        application_id,
        job_id=job_id,
        state="extracting",
        message="Opening the job posting.",
        percent_complete=10,
    )
    await writer.clear_extracted_result(application_id)
    await post_callback_best_effort(
        callback,
        {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "started",
        },
        path="/api/internal/worker/extraction-callback",
        app_id=application_id,
        job_id=job_id,
        callback_stage="extraction started",
    )

    success_payload: Optional[dict[str, Any]] = None

    try:
        if source_capture is not None:
            capture = SourceCapture.model_validate(source_capture)
            context = build_page_context_from_capture(job_url, capture)
            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                state="extracting",
                message="Loaded browser-captured page content.",
                percent_complete=35,
            )
        else:
            context = await scrape_page_context(job_url)
            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                state="extracting",
                message="Captured page content and metadata.",
                percent_complete=40,
            )

        blocked = detect_blocked_page(context)
        if blocked is not None:
            await report_failure(
                writer=writer,
                callback=callback,
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="This source blocked automated retrieval. Paste the job text or complete manual entry.",
                terminal_error_code="blocked_source",
                failure_details=blocked,
            )
            return blocked.model_dump()

        if source_capture is not None and len(context.visible_text.strip()) < 80:
            await report_failure(
                writer=writer,
                callback=callback,
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Captured page text was too limited. Paste more of the posting or complete manual entry.",
                terminal_error_code="extraction_failed",
            )
            return {"status": "insufficient_source_text"}

        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            state="extracting",
            message="Running structured extraction.",
            percent_complete=65,
        )
        extracted = await extractor.extract(context)
        finalized = finalize_extracted_posting(extracted, context)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            state="extracting",
            message="Validating extracted fields.",
            percent_complete=85,
        )
        ExtractedJobPosting.model_validate(finalized.model_dump())
        completed_at = now_iso()
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            state="generation_pending",
            message="Extraction completed.",
            percent_complete=100,
            completed_at=completed_at,
        )
        success_payload = finalized.model_dump()
        await writer.set_extracted_result(
            application_id,
            job_id=job_id,
            extracted=success_payload,
        )
    except PlaywrightTimeoutError as error:
        await report_failure(
            writer=writer,
            callback=callback,
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            message="Extraction timed out. Manual entry is required.",
            terminal_error_code="extraction_failed",
        )
        raise RuntimeError("Extraction timed out.") from error
    except Exception as error:
        await report_failure(
            writer=writer,
            callback=callback,
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            message="Automatic extraction failed. Manual entry is required.",
            terminal_error_code="extraction_failed",
        )
        raise

    if success_payload is not None:
        await post_callback_best_effort(
            callback,
            {
                "application_id": application_id,
                "user_id": user_id,
                "job_id": job_id,
                "event": "succeeded",
                "extracted": success_payload,
            },
            path="/api/internal/worker/extraction-callback",
            app_id=application_id,
            job_id=job_id,
            callback_stage="extraction succeeded",
        )
        return success_payload

    raise RuntimeError("Extraction completed without a success payload.")


# ---------------------------------------------------------------------------
# Callback path constants
# ---------------------------------------------------------------------------

GENERATION_CALLBACK_PATH = "/api/internal/worker/generation-callback"
REGENERATION_CALLBACK_PATH = "/api/internal/worker/regeneration-callback"


# ---------------------------------------------------------------------------
# Generation job
# ---------------------------------------------------------------------------


async def run_generation_job(
    ctx: dict[str, Any],
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    job_title: str,
    company_name: str,
    job_description: str,
    base_resume_content: str,
    personal_info: dict[str, Any],
    section_preferences: list[dict[str, Any]],
    generation_settings: dict[str, Any],
) -> None:
    settings = WorkerSettingsEnv()
    writer = RedisProgressWriter(settings.redis_url)
    callback = BackendCallbackClient(settings)
    public_generation_settings = {
        key: value for key, value in generation_settings.items() if not str(key).startswith("_")
    }

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured.")
    if not settings.generation_agent_model:
        raise RuntimeError("GENERATION_AGENT_MODEL is not configured.")
    if not settings.generation_agent_fallback_model:
        raise RuntimeError("GENERATION_AGENT_FALLBACK_MODEL is not configured.")

    async def on_generation_progress(percent: int, message: str) -> None:
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generating",
            message=message,
            percent_complete=percent,
        )

    try:
        await writer.clear_generation_result(application_id)
        # 1. Starting
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generating",
            message="Preparing generation inputs and section plan",
            percent_complete=5,
        )
        await post_callback_best_effort(
            callback,
            {
                "application_id": application_id,
                "user_id": user_id,
                "job_id": job_id,
                "event": "started",
            },
            path=GENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="generation started",
        )

        # 2. Generate sections (10-80%)
        gen_result = await asyncio.wait_for(
            generate_sections(
                base_resume_content=base_resume_content,
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                section_preferences=section_preferences,
                generation_settings={**public_generation_settings, "_operation": "generation"},
                model=settings.generation_agent_model,
                fallback_model=settings.generation_agent_fallback_model,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                on_progress=on_generation_progress,
            ),
            timeout=FULL_GENERATION_MAX_TIMEOUT_SECONDS,
        )
        if not await is_current_job(writer, application_id, job_id):
            return

        generated_sections = gen_result["sections"]

        # 3. Validate (85%)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generating",
            message="Running deterministic validation and structure checks",
            percent_complete=85,
        )

        validation_result = await validate_resume(
            generated_sections=generated_sections,
            base_resume_content=base_resume_content,
            section_preferences=section_preferences,
            generation_settings=public_generation_settings,
            professional_experience_anchors=gen_result.get("professional_experience_anchors"),
        )
        if not await is_current_job(writer, application_id, job_id):
            return

        if not validation_result["valid"]:
            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind="generation",
                state="generation_failed",
                message="Resume validation failed.",
                percent_complete=100,
                completed_at=now_iso(),
                terminal_error_code="validation_failed",
            )
            await post_callback_best_effort(
                callback,
                build_generation_failure_payload(
                    application_id=application_id,
                    user_id=user_id,
                    job_id=job_id,
                    message="Resume validation failed.",
                    terminal_error_code="validation_failed",
                    validation_errors=validation_result["errors"],
                ),
                path=GENERATION_CALLBACK_PATH,
                app_id=application_id,
                job_id=job_id,
                callback_stage="generation failed",
            )
            return

        # 4. Assemble (95%)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generating",
            message="Assembling final resume draft",
            percent_complete=95,
        )

        content = assemble_resume(
            personal_info=personal_info,
            generated_sections=generated_sections,
        )
        if not await is_current_job(writer, application_id, job_id):
            return

        enabled_ordered = sorted(
            [s for s in section_preferences if s.get("enabled")],
            key=lambda s: s.get("order", 0),
        )

        # 5. Done (100%)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="resume_ready",
            message="Resume generated",
            percent_complete=100,
            completed_at=now_iso(),
        )
        success_payload = build_generation_success_payload(
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            content_md=content,
            generation_params=public_generation_settings,
            sections_snapshot={
                "enabled_sections": [s["name"] for s in enabled_ordered],
                "section_order": [s["name"] for s in enabled_ordered],
            },
        )
        await set_generation_result_best_effort(
            writer,
            application_id=application_id,
            job_id=job_id,
            workflow_kind="generation",
            generated=success_payload["generated"],
        )
        await post_callback_best_effort(
            callback,
            success_payload,
            path=GENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="generation succeeded",
        )

    except asyncio.TimeoutError:
        if not await is_current_job(writer, application_id, job_id):
            return
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generation_failed",
            message="Resume generation timed out. The LLM provider may be slow. Please try again.",
            percent_complete=100,
            completed_at=now_iso(),
            terminal_error_code="generation_timeout",
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Resume generation timed out. The LLM provider may be slow. Please try again.",
                terminal_error_code="generation_timeout",
            ),
            path=GENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="generation failed",
        )
        raise
    except Exception:
        if not await is_current_job(writer, application_id, job_id):
            return
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind="generation",
            state="generation_failed",
            message="Resume generation failed unexpectedly.",
            percent_complete=100,
            completed_at=now_iso(),
            terminal_error_code="generation_error",
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Resume generation failed unexpectedly.",
                terminal_error_code="generation_error",
            ),
            path=GENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="generation failed",
        )
        raise


# ---------------------------------------------------------------------------
# Regeneration job
# ---------------------------------------------------------------------------


async def run_regeneration_job(
    ctx: dict[str, Any],
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    current_draft_content: Optional[str] = None,
    job_title: str,
    company_name: str,
    job_description: str,
    base_resume_content: str,
    personal_info: dict[str, Any],
    section_preferences: list[dict[str, Any]],
    generation_settings: dict[str, Any],
    regeneration_target: str,
    regeneration_instructions: Optional[str] = None,
) -> None:
    settings = WorkerSettingsEnv()
    writer = RedisProgressWriter(settings.redis_url)
    callback = BackendCallbackClient(settings)
    public_generation_settings = {
        key: value for key, value in generation_settings.items() if not str(key).startswith("_")
    }

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured.")
    if not settings.generation_agent_model:
        raise RuntimeError("GENERATION_AGENT_MODEL is not configured.")
    if not settings.generation_agent_fallback_model:
        raise RuntimeError("GENERATION_AGENT_FALLBACK_MODEL is not configured.")

    is_full_regen = regeneration_target == "full"
    workflow_kind = "regeneration_full" if is_full_regen else "regeneration_section"
    workflow_state = "regenerating_full" if is_full_regen else "regenerating_section"
    section_name = None if is_full_regen else regeneration_target
    instructions = None if is_full_regen else regeneration_instructions

    try:
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            state=workflow_state,
            message="Preparing regeneration inputs and section plan",
            percent_complete=5,
        )
        await post_callback_best_effort(
            callback,
            {
                "application_id": application_id,
                "user_id": user_id,
                "job_id": job_id,
                "event": "started",
            },
            path=REGENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="regeneration started",
        )

        if is_full_regen:
            # ---- Full regeneration (same flow as generation) ----
            async def on_regen_progress(percent: int, message: str) -> None:
                await set_progress(
                    writer,
                    application_id,
                    job_id=job_id,
                    workflow_kind=workflow_kind,
                    state=workflow_state,
                    message=message,
                    percent_complete=percent,
                )

            gen_result = await asyncio.wait_for(
                generate_sections(
                    base_resume_content=base_resume_content,
                    job_title=job_title,
                    company_name=company_name,
                    job_description=job_description,
                    section_preferences=section_preferences,
                    generation_settings={**public_generation_settings, "_operation": "regeneration_full"},
                    model=settings.generation_agent_model,
                    fallback_model=settings.generation_agent_fallback_model,
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                    on_progress=on_regen_progress,
                ),
                timeout=FULL_GENERATION_MAX_TIMEOUT_SECONDS,
            )
            if not await is_current_job(writer, application_id, job_id):
                return
            generated_sections = gen_result["sections"]

            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message="Running deterministic validation and structure checks",
                percent_complete=85,
            )

            validation_result = await validate_resume(
                generated_sections=generated_sections,
                base_resume_content=base_resume_content,
                section_preferences=section_preferences,
                generation_settings=public_generation_settings,
                professional_experience_anchors=gen_result.get("professional_experience_anchors"),
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            if not validation_result["valid"]:
                await set_progress(
                    writer,
                    application_id,
                    job_id=job_id,
                    workflow_kind=workflow_kind,
                    state="generation_failed",
                    message="Regeneration validation failed.",
                    percent_complete=100,
                    completed_at=now_iso(),
                    terminal_error_code="validation_failed",
                )
                await post_callback_best_effort(
                    callback,
                    build_generation_failure_payload(
                        application_id=application_id,
                        user_id=user_id,
                        job_id=job_id,
                        message="Regeneration validation failed.",
                        terminal_error_code="validation_failed",
                        validation_errors=validation_result["errors"],
                    ),
                    path=REGENERATION_CALLBACK_PATH,
                    app_id=application_id,
                    job_id=job_id,
                    callback_stage="regeneration failed",
                )
                return

            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message="Assembling regenerated resume draft",
                percent_complete=95,
            )

            content = assemble_resume(
                personal_info=personal_info,
                generated_sections=generated_sections,
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            enabled_ordered = sorted(
                [s for s in section_preferences if s.get("enabled")],
                key=lambda s: s.get("order", 0),
            )
            sections_snapshot = {
                "enabled_sections": [s["name"] for s in enabled_ordered],
                "section_order": [s["name"] for s in enabled_ordered],
            }

        else:
            # ---- Single-section regeneration ----
            if not section_name or not instructions or not current_draft_content:
                raise ValueError(
                    "section_name, instructions, and current_draft_content are required "
                    "for single-section regeneration."
                )

            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message=f"Preparing {section_name} section regeneration",
                percent_complete=20,
            )

            async def on_section_regen_progress(percent: int, message: str) -> None:
                await set_progress(
                    writer,
                    application_id,
                    job_id=job_id,
                    workflow_kind=workflow_kind,
                    state=workflow_state,
                    message=message,
                    percent_complete=percent,
                )

            regenerated_section = await asyncio.wait_for(
                regenerate_single_section(
                    current_draft_content=current_draft_content,
                    section_name=section_name,
                    instructions=instructions,
                    base_resume_content=base_resume_content,
                    job_title=job_title,
                    company_name=company_name,
                    job_description=job_description,
                    generation_settings=public_generation_settings,
                    model=settings.generation_agent_model,
                    fallback_model=settings.generation_agent_fallback_model,
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                    on_progress=on_section_regen_progress,
                ),
                timeout=SECTION_REGENERATION_TIMEOUT_SECONDS,
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            # Validate just this section
            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message=f"Running deterministic validation for regenerated {section_name} section",
                percent_complete=70,
            )

            single_section_prefs = [{"name": section_name, "enabled": True, "order": 0}]
            validation_result = await validate_resume(
                generated_sections=[regenerated_section],
                base_resume_content=base_resume_content,
                section_preferences=single_section_prefs,
                generation_settings=public_generation_settings,
                professional_experience_anchors=regenerated_section.get("professional_experience_anchors"),
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            if not validation_result["valid"]:
                await set_progress(
                    writer,
                    application_id,
                    job_id=job_id,
                    workflow_kind=workflow_kind,
                    state="generation_failed",
                    message=f"Validation failed for regenerated {section_name} section.",
                    percent_complete=100,
                    completed_at=now_iso(),
                    terminal_error_code="validation_failed",
                )
                await post_callback_best_effort(
                    callback,
                    build_generation_failure_payload(
                        application_id=application_id,
                        user_id=user_id,
                        job_id=job_id,
                        message=f"Validation failed for regenerated {section_name} section.",
                        terminal_error_code="validation_failed",
                        validation_errors=validation_result["errors"],
                    ),
                    path=REGENERATION_CALLBACK_PATH,
                    app_id=application_id,
                    job_id=job_id,
                    callback_stage="regeneration failed",
                )
                return

            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message=f"Merging regenerated {section_name} section into draft",
                percent_complete=90,
            )

            # Replace section in draft
            display_name = SECTION_DISPLAY_NAMES.get(
                section_name, section_name.replace("_", " ").title()
            )
            content = _replace_section_in_draft(
                current_draft_content, section_name, regenerated_section["content"], display_name
            )
            sections_snapshot = {
                "enabled_sections": [section_name],
                "section_order": [section_name],
            }

        # ---- Success callback (shared by both paths) ----
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            state="resume_ready",
            message="Regeneration complete",
            percent_complete=100,
            completed_at=now_iso(),
        )
        success_payload = build_generation_success_payload(
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            content_md=content,
            generation_params=public_generation_settings,
            sections_snapshot=sections_snapshot,
        )
        await set_generation_result_best_effort(
            writer,
            application_id=application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            generated=success_payload["generated"],
        )
        await post_callback_best_effort(
            callback,
            success_payload,
            path=REGENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="regeneration succeeded",
        )

    except asyncio.TimeoutError:
        if not await is_current_job(writer, application_id, job_id):
            return
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            state="generation_failed",
            message="Regeneration timed out. The LLM provider may be slow. Please try again.",
            percent_complete=100,
            completed_at=now_iso(),
            terminal_error_code="regeneration_timeout",
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Regeneration timed out. The LLM provider may be slow. Please try again.",
                terminal_error_code="regeneration_timeout",
            ),
            path=REGENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="regeneration failed",
        )
        raise
    except Exception:
        if not await is_current_job(writer, application_id, job_id):
            return
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            state="generation_failed",
            message="Regeneration failed unexpectedly.",
            percent_complete=100,
            completed_at=now_iso(),
            terminal_error_code="regeneration_error",
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Regeneration failed unexpectedly.",
                terminal_error_code="regeneration_error",
            ),
            path=REGENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="regeneration failed",
        )
        raise


class WorkerSettings:
    functions = [report_bootstrap_progress, run_extraction_job, run_generation_job, run_regeneration_job]
    redis_settings = RedisSettings.from_dsn(WorkerSettingsEnv().redis_url)
    max_tries = 2
