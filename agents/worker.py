from __future__ import annotations

import json
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
    job_description: str = Field(description="Required non-empty job description.")
    company: Optional[str] = Field(default=None, description="Optional company name.")
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

    @field_validator("company", "job_posting_origin_other_text", "extracted_reference_id")
    @classmethod
    def normalize_optional_value(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
            context.visible_text[:5000],
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
    state: str,
    message: str,
    percent_complete: int,
    created_at: Optional[str] = None,
    completed_at: Optional[str] = None,
    terminal_error_code: Optional[str] = None,
) -> JobProgress:
    return JobProgress(
        job_id=job_id,
        workflow_kind="extraction",
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

    async def get(self, application_id: str) -> Optional[JobProgress]:
        payload = await self._redis.get(self._key(application_id))
        if payload is None:
            return None
        return JobProgress.model_validate(json.loads(payload))

    async def set(self, application_id: str, progress: JobProgress, ttl_seconds: int = 86400) -> None:
        await self._redis.set(self._key(application_id), progress.model_dump_json(), ex=ttl_seconds)


class BackendCallbackClient:
    def __init__(self, settings: WorkerSettingsEnv) -> None:
        self._settings = settings

    async def post(self, payload: dict[str, Any]) -> None:
        if not self._settings.worker_callback_secret:
            raise RuntimeError("WORKER_CALLBACK_SECRET is not configured.")

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{self._settings.backend_api_url.rstrip('/')}/api/internal/worker/extraction-callback",
                json=payload,
                headers={"X-Worker-Secret": self._settings.worker_callback_secret},
            )
            response.raise_for_status()


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
        ).with_structured_output(ExtractedJobPosting)

        prompt = [
            (
                "system",
                (
                    "Extract job-posting fields from the supplied webpage context. "
                    "Do not invent facts. job_title and job_description are required. "
                    "Use only these normalized origins when known: linkedin, indeed, google_jobs, "
                    "glassdoor, ziprecruiter, monster, dice, company_website, other. "
                    "If origin is unknown, leave it null."
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
                        "visible_text": context.visible_text[:15000],
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
            visible_text = await page.locator("body").inner_text(timeout=5_000)
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
        visible_text=visible_text[:25000],
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
        visible_text=capture.source_text[:25000],
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
        job_posting_origin=origin,
        job_posting_origin_other_text=other_text,
        extracted_reference_id=extracted.extracted_reference_id or context.extracted_reference_id,
    )


async def set_progress(
    writer: RedisProgressWriter,
    application_id: str,
    *,
    job_id: str,
    state: str,
    message: str,
    percent_complete: int,
    completed_at: Optional[str] = None,
    terminal_error_code: Optional[str] = None,
) -> JobProgress:
    existing = await writer.get(application_id)
    progress = build_progress(
        job_id=job_id,
        state=state,
        message=message,
        percent_complete=percent_complete,
        created_at=existing.created_at if existing else None,
        completed_at=completed_at,
        terminal_error_code=terminal_error_code,
    )
    await writer.set(application_id, progress)
    return progress


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
    await callback.post(
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
        }
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
    await callback.post(
        {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "started",
        }
    )

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
        await callback.post(
            {
                "application_id": application_id,
                "user_id": user_id,
                "job_id": job_id,
                "event": "succeeded",
                "extracted": finalized.model_dump(),
            }
        )
        return finalized.model_dump()
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


class WorkerSettings:
    functions = [report_bootstrap_progress, run_extraction_job]
    redis_settings = RedisSettings.from_dsn(WorkerSettingsEnv().redis_url)
    max_tries = 2
