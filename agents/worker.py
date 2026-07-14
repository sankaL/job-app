from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Awaitable, Callable, Literal, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from arq.connections import RedisSettings
from langchain_openai import ChatOpenAI
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Route, TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis

from assembly import assemble_resume
from generation import (
    GeneratedResumePayload,
    RegeneratedSectionPayload,
    SECTION_DISPLAY_NAMES,
    SECTION_REGENERATION_LLM_TIMEOUT_SECONDS,
    _replace_section_in_draft,
    generate_sections,
    render_semantic_section,
    regenerate_single_section,
    repair_generated_response,
)
from length_policy import assess_resume_length
from privacy import sanitize_resume_markdown
from resume_judge import judge_resume
from validation import validate_resume
from url_security import validate_public_http_url

root_logger = logging.getLogger()
if root_logger.level > logging.INFO:
    root_logger.setLevel(logging.INFO)
logger = logging.getLogger(__name__)

OPENROUTER_GENERATION_MODEL_REASONING_EFFORTS: dict[str, set[str]] = {
    "google/gemini-3-flash-preview": {"none", "low", "medium", "high"},
    "openai/gpt-5.4-mini": {"none", "low", "medium", "high", "xhigh"},
    "deepseek/deepseek-v4-flash": {"none", "high", "xhigh"},
    "google/gemini-3.5-flash": {"none", "low", "medium", "high"},
}
logger.setLevel(logging.INFO)

CALLBACK_REQUEST_TIMEOUT_SECONDS = 5.0
CALLBACK_RETRY_ATTEMPTS = 2
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
FULL_GENERATION_MAX_TIMEOUT_SECONDS = 240.0
SECTION_REGENERATION_TIMEOUT_SECONDS = 120.0
RESUME_JUDGE_TIMEOUT_SECONDS = 60.0
KEYWORD_EXTRACTION_MODEL_TIMEOUT_SECONDS = 30.0
KEYWORD_EXTRACTION_MAX_KEYWORDS = 30
EXTRACTION_TEXT_LIMIT = 40_000
EXTRACTION_BLOCKED_PAGE_SCAN_LIMIT = 8_000


class WorkerSettingsEnv(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    redis_url: str = "redis://localhost:6379/0"
    backend_api_url: str = "http://backend:8000"
    railway_service_backend_url: Optional[str] = None
    worker_callback_secret: Optional[str] = None
    shared_contract_path: str = "/workspace/shared/workflow-contract.json"
    openrouter_api_key: Optional[str] = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    extraction_agent_model: Optional[str] = None
    extraction_agent_fallback_model: Optional[str] = None
    keyword_extraction_agent_model: Optional[str] = None
    keyword_extraction_agent_fallback_model: Optional[str] = None
    generation_agent_model: Optional[str] = None
    generation_agent_fallback_model: Optional[str] = None
    generation_agent_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh"] = "none"
    resume_judge_agent_model: Optional[str] = "openai/gpt-5.4-mini"
    resume_judge_agent_fallback_model: Optional[str] = "openai/gpt-5-mini"
    resume_judge_agent_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh"] = "none"
    validation_agent_model: Optional[str] = None
    validation_agent_fallback_model: Optional[str] = None

    @field_validator("generation_agent_reasoning_effort", mode="before")
    @classmethod
    def normalize_generation_agent_reasoning_effort(cls, value: Any) -> str:
        normalized = str(value or "none").strip().lower()
        allowed = {"none", "low", "medium", "high", "xhigh"}
        if normalized not in allowed:
            allowed_display = ", ".join(sorted(allowed))
            raise ValueError(
                f"generation_agent_reasoning_effort must be one of: {allowed_display}."
            )
        return normalized

    @field_validator("resume_judge_agent_reasoning_effort", mode="before")
    @classmethod
    def normalize_resume_judge_agent_reasoning_effort(cls, value: Any) -> str:
        normalized = str(value or "none").strip().lower()
        allowed = {"none", "low", "medium", "high", "xhigh"}
        if normalized not in allowed:
            allowed_display = ", ".join(sorted(allowed))
            raise ValueError(
                f"resume_judge_agent_reasoning_effort must be one of: {allowed_display}."
            )
        return normalized

    @model_validator(mode="after")
    def validate_distinct_llm_fallbacks(self) -> "WorkerSettingsEnv":
        if (
            self.generation_agent_model
            and self.generation_agent_fallback_model
            and self.generation_agent_model == self.generation_agent_fallback_model
        ):
            raise ValueError(
                "generation_agent_fallback_model must differ from generation_agent_model to enable fallback."
            )
        if (
            self.resume_judge_agent_model
            and self.resume_judge_agent_fallback_model
            and self.resume_judge_agent_model == self.resume_judge_agent_fallback_model
        ):
            raise ValueError(
                "resume_judge_agent_fallback_model must differ from resume_judge_agent_model to enable fallback."
            )
        return self


def _resolve_generation_models(
    generation_settings: dict[str, Any],
    settings: WorkerSettingsEnv,
) -> tuple[str, str]:
    has_tier_primary = "_generation_model" in generation_settings
    has_tier_fallback = "_generation_fallback_model" in generation_settings
    primary_value = generation_settings.get("_generation_model") if has_tier_primary else settings.generation_agent_model
    fallback_value = (
        generation_settings.get("_generation_fallback_model")
        if has_tier_fallback
        else settings.generation_agent_fallback_model
    )
    primary_model = str(primary_value or "").strip()
    fallback_model = str(fallback_value or "").strip()
    if not primary_model:
        if has_tier_primary:
            raise RuntimeError("Tier generation model is blank.")
        raise RuntimeError("GENERATION_AGENT_MODEL is not configured.")
    if not fallback_model:
        if has_tier_fallback:
            raise RuntimeError("Tier fallback generation model is blank.")
        raise RuntimeError("GENERATION_AGENT_FALLBACK_MODEL is not configured.")
    if primary_model == fallback_model:
        raise RuntimeError("Generation fallback model must differ from generation model.")
    if has_tier_primary and primary_model not in OPENROUTER_GENERATION_MODEL_REASONING_EFFORTS:
        raise RuntimeError("Tier generation model is not supported.")
    if has_tier_fallback and fallback_model not in OPENROUTER_GENERATION_MODEL_REASONING_EFFORTS:
        raise RuntimeError("Tier fallback generation model is not supported.")
    return primary_model, fallback_model


def _resolve_generation_reasoning_efforts(
    generation_settings: dict[str, Any],
    settings: WorkerSettingsEnv,
) -> tuple[str, str]:
    primary_reasoning = str(
        generation_settings.get(
            "_generation_reasoning_effort",
            settings.generation_agent_reasoning_effort,
        )
        or "none"
    ).strip().lower()
    fallback_reasoning = str(
        generation_settings.get(
            "_generation_fallback_reasoning_effort",
            primary_reasoning,
        )
        or "none"
    ).strip().lower()
    allowed = {"none", "low", "medium", "high", "xhigh"}
    if primary_reasoning not in allowed:
        raise RuntimeError("Tier generation reasoning effort is invalid.")
    if fallback_reasoning not in allowed:
        raise RuntimeError("Tier fallback generation reasoning effort is invalid.")
    primary_model = str(generation_settings.get("_generation_model") or "").strip()
    fallback_model = str(generation_settings.get("_generation_fallback_model") or "").strip()
    if primary_model:
        model_efforts = OPENROUTER_GENERATION_MODEL_REASONING_EFFORTS.get(primary_model)
        if model_efforts is None or primary_reasoning not in model_efforts:
            raise RuntimeError("Tier generation reasoning effort is not supported by the generation model.")
    if fallback_model:
        fallback_efforts = OPENROUTER_GENERATION_MODEL_REASONING_EFFORTS.get(fallback_model)
        if fallback_efforts is None or fallback_reasoning not in fallback_efforts:
            raise RuntimeError("Tier fallback reasoning effort is not supported by the fallback generation model.")
    return primary_reasoning, fallback_reasoning


def _stored_generation_settings(
    generation_settings: dict[str, Any],
    *,
    model_used: Optional[str] = None,
) -> dict[str, Any]:
    stored = {
        key: value
        for key, value in generation_settings.items()
        if key
        not in {
            "_generation_model",
            "_generation_reasoning_effort",
            "_generation_fallback_model",
            "_generation_fallback_reasoning_effort",
            "_base_resume_snapshot_content",
            "_current_draft_snapshot_content",
        }
    }
    if model_used is not None:
        stored["model_used"] = model_used
    return stored


def _quota_period_start(generation_settings: dict[str, Any]) -> Optional[str]:
    value = str(generation_settings.get("quota_period_start") or "").strip()
    return value or None


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
    quota_period_start: Optional[str] = None


class PageContext(BaseModel):
    source_url: Optional[str]
    final_url: Optional[str]
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
    job_keywords: Optional[dict[str, Any]] = Field(
        default=None,
        description="Optional high-value ATS keyword extraction payload.",
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


class ExtractedKeywordPayload(BaseModel):
    keywords: list[str] = Field(
        description="High-value exact phrases copied from the job description."
    )

    @field_validator("keywords")
    @classmethod
    def normalize_keywords(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = re.sub(r"\s+", " ", str(item or "")).strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(text)
        return normalized[:KEYWORD_EXTRACTION_MAX_KEYWORDS]


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
    regeneration_target: Optional[str] = None,
    attempts: Optional[list[dict[str, Any]]] = None,
    length_diagnostics: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    generated: dict[str, Any] = {
        "content_md": content_md,
        "generation_params": generation_params,
        "sections_snapshot": sections_snapshot,
    }
    if attempts is not None:
        generated["attempts"] = attempts
    if length_diagnostics is not None:
        generated["length_diagnostics"] = length_diagnostics
    payload: dict[str, Any] = {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "succeeded",
        "generated": generated,
    }
    if regeneration_target is not None:
        payload["regeneration_target"] = regeneration_target
    return payload


def build_generation_failure_payload(
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    message: str,
    terminal_error_code: str,
    failure_details: Optional[dict[str, Any]] = None,
    validation_errors: Optional[list[Any]] = None,
    quota_period_start: Optional[str] = None,
    regeneration_target: Optional[str] = None,
) -> dict[str, Any]:
    normalized_details = dict(failure_details or {})
    if validation_errors:
        normalized = [
            formatted
            for formatted in (_normalize_validation_error(error) for error in validation_errors)
            if formatted
        ]
        if normalized:
            normalized_details["validation_errors"] = normalized

    payload: dict[str, Any] = {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "failed",
        "failure": {
            "message": message,
            "terminal_error_code": terminal_error_code,
            "failure_details": normalized_details or None,
        },
    }
    payload["quota_period_start"] = quota_period_start
    if regeneration_target is not None:
        payload["regeneration_target"] = regeneration_target
    return payload


def build_resume_judge_success_payload(
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    evaluated_draft_updated_at: str,
    input_signature: str,
    resume_judge_result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "succeeded",
        "evaluated_draft_updated_at": evaluated_draft_updated_at,
        "input_signature": input_signature,
        "result": resume_judge_result,
    }


def build_resume_judge_failure_payload(
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    evaluated_draft_updated_at: str,
    input_signature: str,
    resume_judge_result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "failed",
        "evaluated_draft_updated_at": evaluated_draft_updated_at,
        "input_signature": input_signature,
        "failure": {
            "message": resume_judge_result.get("message"),
            "result": resume_judge_result,
        },
    }


def _sanitize_error(error: BaseException) -> dict[str, Any]:
    message = str(error).strip()
    if len(message) > 240:
        message = message[:237] + "..."
    return {
        "error_type": type(error).__name__,
        "message": message,
    }


def _sanitize_attempts(attempts: Optional[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    if not attempts:
        return []
    sanitized: list[dict[str, Any]] = []
    for attempt in attempts:
        sanitized_attempt = {
            "model": attempt.get("model"),
            "reasoning_effort": attempt.get("reasoning_effort"),
            "transport_mode": attempt.get("transport_mode"),
            "outcome": attempt.get("outcome"),
            "elapsed_ms": attempt.get("elapsed_ms"),
        }
        retry_reason = attempt.get("retry_reason")
        if retry_reason:
            sanitized_attempt["retry_reason"] = retry_reason
        sanitized.append(sanitized_attempt)
    return sanitized


def _log_generation_event(event: str, **payload: Any) -> None:
    logger.info(
        "generation_event %s",
        json.dumps({"event": event, **payload}, sort_keys=True, default=str),
    )


def _build_sections_response_payload(generated_sections: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "sections": [
            {
                "id": section["name"],
                "heading": section["heading"],
                "content": section.get("semantic_content") or {},
                "supporting_snippets": section.get("supporting_snippets") or [],
            }
            for section in generated_sections
        ]
    }


def _build_section_response_payload(regenerated_section: dict[str, Any]) -> dict[str, Any]:
    return {
        "section": {
            "id": regenerated_section["name"],
            "heading": regenerated_section["heading"],
            "content": regenerated_section.get("semantic_content") or {},
            "supporting_snippets": regenerated_section.get("supporting_snippets") or [],
        }
    }


def _llm_failure_stage_from_attempts(
    attempts: list[dict[str, Any]],
    *,
    primary_model: str,
    fallback_model: str,
) -> str:
    if not attempts:
        return "worker_start"
    last_model = str(attempts[-1].get("model") or "")
    if fallback_model and fallback_model != primary_model and last_model == fallback_model:
        return "llm_fallback"
    return "llm_primary"


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
            context.page_title or "",
            context.final_url or "",
            " ".join(f"{key} {value}" for key, value in context.meta.items()),
            (context.visible_text or "")[:EXTRACTION_BLOCKED_PAGE_SCAN_LIMIT],
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
    quota_period_start: Optional[str] = None,
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
        quota_period_start=quota_period_start,
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

    @staticmethod
    def _normalize_base_url(value: Optional[str], *, default_scheme: str) -> Optional[str]:
        stripped = str(value or "").strip()
        if not stripped:
            return None
        parsed = urlparse(stripped if "://" in stripped else f"{default_scheme}://{stripped}")
        if not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"

    def _candidate_base_urls(self) -> list[str]:
        candidates: list[str] = []

        def add_candidate(value: Optional[str], *, default_scheme: str) -> None:
            normalized = self._normalize_base_url(value, default_scheme=default_scheme)
            if normalized and normalized not in candidates:
                candidates.append(normalized)

        add_candidate(self._settings.backend_api_url, default_scheme="http")

        primary = candidates[0] if candidates else None
        if primary is not None:
            parsed = urlparse(primary)
            hostname = parsed.hostname or ""
            if hostname.endswith(".railway.internal") and parsed.port == 8000:
                add_candidate(f"{parsed.scheme}://{hostname}:8080", default_scheme=parsed.scheme)
                add_candidate(f"{parsed.scheme}://{hostname}", default_scheme=parsed.scheme)

        add_candidate(self._settings.railway_service_backend_url, default_scheme="https")
        return candidates

    async def post(self, payload: dict[str, Any], *, path: str = "/api/internal/worker/extraction-callback") -> None:
        if not self._settings.worker_callback_secret:
            raise RuntimeError("WORKER_CALLBACK_SECRET is not configured.")
        base_urls = self._candidate_base_urls()
        if not base_urls:
            raise RuntimeError("BACKEND_API_URL is not configured.")
        last_error: Optional[Exception] = None
        for attempt in range(CALLBACK_RETRY_ATTEMPTS):
            for base_url in base_urls:
                try:
                    async with httpx.AsyncClient(timeout=CALLBACK_REQUEST_TIMEOUT_SECONDS) as client:
                        response = await client.post(
                            f"{base_url.rstrip('/')}{path}",
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

    async def extract(self, context: PageContext) -> tuple[ExtractedJobPosting, str]:
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
                res = await self._extract_with_model(model_name, context)
                return res, model_name
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
                    "Return exactly one JSON object matching this schema and no prose or extra keys: "
                    '{"job_title":"...","job_description":"...","company":null,'
                    '"job_location_text":null,"compensation_text":null,'
                    '"job_posting_origin":null,"job_posting_origin_other_text":null,'
                    '"extracted_reference_id":null}.\n'
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


class OpenRouterKeywordExtractionAgent:
    def __init__(self, settings: WorkerSettingsEnv) -> None:
        self._settings = settings

    def _models(self) -> tuple[str, str]:
        primary = str(self._settings.keyword_extraction_agent_model or self._settings.extraction_agent_model or "").strip()
        fallback = str(
            self._settings.keyword_extraction_agent_fallback_model
            or self._settings.extraction_agent_fallback_model
            or primary
        ).strip()
        if not primary:
            raise RuntimeError("KEYWORD_EXTRACTION_AGENT_MODEL or EXTRACTION_AGENT_MODEL is not configured.")
        if not fallback:
            raise RuntimeError("Keyword extraction fallback model is not configured.")
        return primary, fallback

    async def extract_keywords(self, job_description: str) -> tuple[dict[str, Any], str]:
        if not self._settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not configured.")
        primary, fallback = self._models()
        last_error: Optional[Exception] = None
        for model_name in (primary, fallback):
            try:
                payload = await self._extract_with_model(model_name, job_description)
                keywords = filter_keywords_to_job_description(payload.keywords, job_description)
                return build_job_keywords_payload(
                    status="succeeded",
                    job_description=job_description,
                    keywords=keywords,
                    model_used=model_name,
                ), model_name
            except Exception as error:
                last_error = error
        raise RuntimeError("Keyword extraction failed on both primary and fallback models.") from last_error

    async def _extract_with_model(
        self,
        model_name: str,
        job_description: str,
    ) -> ExtractedKeywordPayload:
        llm = ChatOpenAI(
            model=model_name,
            api_key=self._settings.openrouter_api_key,
            base_url=self._settings.openrouter_base_url,
            temperature=0,
            request_timeout=KEYWORD_EXTRACTION_MODEL_TIMEOUT_SECONDS,
            max_retries=0,
        ).with_structured_output(ExtractedKeywordPayload)

        prompt = [
            (
                "system",
                (
                    "Extract purposeful ATS keywords from a job description.\n"
                    "Return exactly one JSON object matching this schema and no prose or extra keys: "
                    '{"keywords":["exact phrase from the job description"]}.\n'
                    "Rules:\n"
                    "- Return 8 to 30 high-value keywords when the posting contains enough signal.\n"
                    "- Every keyword must be copied exactly from the job description text, preserving wording.\n"
                    "- Prefer repeated terms, required qualifications, preferred qualifications, tools, technologies, credentials, role-title phrases, and core responsibilities.\n"
                    "- Prefer concise phrases of 1 to 5 words over long sentences.\n"
                    "- Exclude generic filler, benefits, legal/EEO language, company boilerplate, and vague soft skills unless clearly role-critical.\n"
                    "- Do not include synonyms, inferred terms, normalized variants, plural variants, or reordered wording.\n"
                    "- Deduplicate case-insensitively."
                ),
            ),
            (
                "human",
                json.dumps({"job_description": job_description[:EXTRACTION_TEXT_LIMIT]}),
            ),
        ]
        return await llm.ainvoke(prompt)


class OutboundRequestGuard:
    def __init__(
        self,
        *,
        validator: Callable[[str], Awaitable[None]] = validate_public_http_url,
    ) -> None:
        self._validator = validator
        self._validated_hosts: set[tuple[str, int]] = set()
        self.blocked_request = False

    async def __call__(self, route: Route) -> None:
        request_url = route.request.url
        parsed = urlparse(request_url)
        if parsed.scheme in {"about", "blob", "data"}:
            await route.continue_()
            return

        host_key = (
            (parsed.hostname or "").lower(),
            parsed.port or (443 if parsed.scheme == "https" else 80),
        )
        try:
            if host_key not in self._validated_hosts:
                await self._validator(request_url)
                self._validated_hosts.add(host_key)
        except ValueError:
            self.blocked_request = True
            await route.abort("blockedbyclient")
            return
        await route.continue_()


async def scrape_page_context(job_url: str) -> PageContext:
    await validate_public_http_url(job_url)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            browser_context = await browser.new_context()
            outbound_guard = OutboundRequestGuard()
            await browser_context.route("**/*", outbound_guard)
            page = await browser_context.new_page()
            try:
                await page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            except PlaywrightError as error:
                if outbound_guard.blocked_request:
                    raise ValueError("Job URL attempted to access a non-public network address.") from error
                raise
            await page.wait_for_load_state("networkidle", timeout=10_000)
            if outbound_guard.blocked_request:
                raise ValueError("Job URL attempted to access a non-public network address.")
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


def build_page_context_from_capture(job_url: Optional[str], capture: SourceCapture) -> PageContext:
    final_url = capture.source_url or job_url
    reference_id = extract_reference_id(final_url, capture.source_text)
    return PageContext(
        source_url=job_url,
        final_url=final_url,
        page_title=(capture.page_title or "").strip(),
        meta=dict(list(capture.meta.items())[:50]),
        json_ld=capture.json_ld[:10],
        visible_text=capture.source_text[:EXTRACTION_TEXT_LIMIT],
        detected_origin=normalize_origin_from_url(final_url) if final_url else None,
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
        job_keywords=extracted.job_keywords,
    )


def keyword_source_hash(job_description: str) -> str:
    # Keep in sync with ApplicationService._keyword_source_hash in the API process.
    normalized = re.sub(r"\s+", " ", str(job_description or "")).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_keyword_search_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def keyword_occurs_exact_case_insensitive(keyword: str, job_description: str) -> bool:
    normalized_keyword = normalize_keyword_search_text(keyword)
    normalized_description = normalize_keyword_search_text(job_description)
    if not normalized_keyword or not normalized_description:
        return False
    escaped = re.escape(normalized_keyword).replace(r"\ ", r"\s+")
    prefix = r"(?<![a-z0-9])"
    suffix = r"(?![a-z0-9])"
    return re.search(f"{prefix}{escaped}{suffix}", normalized_description, flags=re.I) is not None


def filter_keywords_to_job_description(keywords: list[str], job_description: str) -> list[str]:
    # Keep exact-phrase boundary behavior in sync with ApplicationService._filter_keywords_to_job_description.
    filtered: list[str] = []
    seen: set[str] = set()
    for keyword in keywords:
        normalized = re.sub(r"\s+", " ", str(keyword or "")).strip()
        if not normalized:
            continue
        dedupe_key = normalized.lower()
        if dedupe_key in seen:
            continue
        if not keyword_occurs_exact_case_insensitive(normalized, job_description):
            continue
        seen.add(dedupe_key)
        filtered.append(normalized)
        if len(filtered) >= KEYWORD_EXTRACTION_MAX_KEYWORDS:
            break
    return filtered


def build_job_keywords_payload(
    *,
    status: str,
    job_description: str,
    keywords: Optional[list[str]] = None,
    model_used: Optional[str] = None,
    job_id: Optional[str] = None,
    message: Optional[str] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "source_hash": keyword_source_hash(job_description),
        "keywords": [{"text": keyword, "source": "extracted"} for keyword in (keywords or [])],
        "updated_at": now_iso(),
    }
    if status == "succeeded":
        payload["extracted_at"] = payload["updated_at"]
    if model_used:
        payload["model_used"] = model_used
    if job_id:
        payload["job_id"] = job_id
    if message:
        payload["message"] = message[:240]
    return payload


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
    quota_period_start: Optional[str] = None,
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
        quota_period_start=quota_period_start or (existing.quota_period_start if existing is not None else None),
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
        _log_generation_event(
            "callback_delivered",
            application_id=app_id,
            job_id=job_id,
            callback_stage=callback_stage,
            path=path,
        )
    except Exception as error:
        _log_generation_event(
            "callback_delivery_failed",
            application_id=app_id,
            job_id=job_id,
            callback_stage=callback_stage,
            path=path,
            error=_sanitize_error(error),
        )
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
        _log_generation_event(
            "generation_cache_write_succeeded",
            application_id=application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
        )
    except Exception as error:
        _log_generation_event(
            "generation_cache_write_failed",
            application_id=application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            error=_sanitize_error(error),
        )
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
    job_url: Optional[str],
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
            if job_url is None:
                raise ValueError("Job URL is required when no source capture is provided.")
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
        extracted, model_used = await extractor.extract(context)
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
        success_payload["model_used"] = model_used
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


async def run_keyword_extraction_job(
    ctx: dict[str, Any],
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    job_description: str,
    source_hash: str,
) -> dict[str, Any]:
    del ctx
    settings = WorkerSettingsEnv()
    callback = BackendCallbackClient(settings)
    extractor = OpenRouterKeywordExtractionAgent(settings)

    if keyword_source_hash(job_description) != source_hash:
        payload = {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "failed",
            "source_hash": source_hash,
            "failure": {"message": "Keyword extraction source changed before the job started."},
        }
        await post_callback_best_effort(
            callback,
            payload,
            path=KEYWORD_EXTRACTION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="keyword extraction failed",
        )
        return payload

    await post_callback_best_effort(
        callback,
        {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "started",
            "source_hash": source_hash,
        },
        path=KEYWORD_EXTRACTION_CALLBACK_PATH,
        app_id=application_id,
        job_id=job_id,
        callback_stage="keyword extraction started",
    )

    try:
        keyword_payload, model_used = await extractor.extract_keywords(job_description)
    except Exception as error:
        failure_payload = {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "failed",
            "source_hash": source_hash,
            "failure": {"message": "Keyword extraction failed."},
        }
        _log_generation_event(
            "keyword_extraction_failed",
            application_id=application_id,
            job_id=job_id,
            error=_sanitize_error(error),
        )
        await post_callback_best_effort(
            callback,
            failure_payload,
            path=KEYWORD_EXTRACTION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="keyword extraction failed",
        )
        return failure_payload

    keywords = [
        str(item.get("text") or "").strip()
        for item in keyword_payload.get("keywords", [])
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    ]
    success_payload = {
        "application_id": application_id,
        "user_id": user_id,
        "job_id": job_id,
        "event": "succeeded",
        "source_hash": source_hash,
        "keywords": keywords,
        "model_used": model_used,
    }
    await post_callback_best_effort(
        callback,
        success_payload,
        path=KEYWORD_EXTRACTION_CALLBACK_PATH,
        app_id=application_id,
        job_id=job_id,
        callback_stage="keyword extraction succeeded",
    )
    return success_payload


# ---------------------------------------------------------------------------
# Callback path constants
# ---------------------------------------------------------------------------

GENERATION_CALLBACK_PATH = "/api/internal/worker/generation-callback"
REGENERATION_CALLBACK_PATH = "/api/internal/worker/regeneration-callback"
RESUME_JUDGE_CALLBACK_PATH = "/api/internal/worker/resume-judge-callback"
KEYWORD_EXTRACTION_CALLBACK_PATH = "/api/internal/worker/keyword-extraction-callback"


def _length_validation_mode_for_operation(operation: str) -> str:
    if operation == "keyword_optimization":
        return "preserve"
    return "full_draft"


def _sanitize_length_diagnostics(assessment: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "target_length",
        "target_label",
        "target_min",
        "target_max",
        "hard_cap",
        "generated_word_count",
        "source_word_count",
        "minimum_acceptable_words",
        "source_aware_minimum",
        "source_limited_allowed",
        "source_limited_length",
        "underfilled",
        "outside_target_range",
        "above_hard_cap",
    )
    return {key: assessment[key] for key in keys if key in assessment}


def _build_length_diagnostics(
    *,
    generated_sections: list[dict[str, Any]],
    base_resume_content: str,
    generation_settings: dict[str, Any],
) -> dict[str, Any]:
    target_length = generation_settings.get("page_length", generation_settings.get("target_length", "1_page"))
    generated_text = "\n\n".join(str(section.get("content") or "") for section in generated_sections)
    sanitized_base_resume = sanitize_resume_markdown(base_resume_content).sanitized_markdown
    return _sanitize_length_diagnostics(
        assess_resume_length(
            generated_text=generated_text,
            source_text=sanitized_base_resume,
            target_length=str(target_length or "1_page"),
        )
    )


async def _validate_generated_sections_with_repair(
    *,
    generated_sections: list[dict[str, Any]],
    base_resume_content: str,
    section_preferences: list[dict[str, Any]],
    generation_settings: dict[str, Any],
    professional_experience_anchors: Optional[list[dict[str, Any]]],
    prompt: list[tuple[str, str]],
    section_ids: list[str],
    operation: str,
    model: str,
    fallback_model: str,
    model_used: str,
    attempt_diagnostics: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    reasoning_effort: str = "none",
    fallback_reasoning_effort: str = "none",
    repair_deadline: float,
    on_progress,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]], Optional[dict[str, Any]]]:
    aggressiveness = str(generation_settings.get("aggressiveness", "medium")).lower()
    validation_result = await validate_resume(
        generated_sections=generated_sections,
        base_resume_content=base_resume_content,
        section_preferences=section_preferences,
        generation_settings=generation_settings,
        professional_experience_anchors=professional_experience_anchors,
        length_validation_mode=_length_validation_mode_for_operation(operation),
    )
    if validation_result["valid"]:
        return generated_sections, validation_result, attempt_diagnostics, None

    await on_progress(88, "Validation failed. Attempting one repair pass")
    remaining_timeout_seconds = max(0.0, repair_deadline - perf_counter())
    repaired_payload, repair_model, repair_attempts, repair_error = await repair_generated_response(
        prompt=prompt,
        response_model=GeneratedResumePayload,
        expected_section_ids=section_ids,
        operation=operation,
        validation_errors=validation_result["errors"],
        prior_response=_build_sections_response_payload(generated_sections),
        model=model,
        fallback_model=fallback_model,
        model_used=model_used,
        prior_attempts=attempt_diagnostics,
        api_key=api_key,
        base_url=base_url,
        timeout=remaining_timeout_seconds,
        aggressiveness=aggressiveness,
        reasoning_effort=reasoning_effort,
        fallback_reasoning_effort=fallback_reasoning_effort,
    )
    combined_attempts = [*attempt_diagnostics, *_sanitize_attempts(repair_attempts)]
    if repair_error is not None or repaired_payload is None:
        failure_details = {
            "failure_stage": "repair",
            "attempt_count": len(combined_attempts),
            "attempts": combined_attempts,
            "repair_model": repair_model,
            "repair_error": _sanitize_error(repair_error or RuntimeError("Unknown repair failure")),
            "terminal_error_code": "validation_failed",
        }
        return generated_sections, validation_result, combined_attempts, failure_details

    repaired_sections = [
        render_semantic_section(
            section,
            professional_experience_anchors=professional_experience_anchors or [],
            aggressiveness=aggressiveness,
        )
        for section in repaired_payload.sections
    ]
    validation_after_repair = await validate_resume(
        generated_sections=repaired_sections,
        base_resume_content=base_resume_content,
        section_preferences=section_preferences,
        generation_settings=generation_settings,
        professional_experience_anchors=professional_experience_anchors,
        length_validation_mode=_length_validation_mode_for_operation(operation),
    )
    if validation_after_repair["valid"]:
        return repaired_sections, validation_after_repair, combined_attempts, None

    failure_details = {
        "failure_stage": "validation",
        "attempt_count": len(combined_attempts),
        "attempts": combined_attempts,
        "repair_model": repair_model,
        "terminal_error_code": "validation_failed",
    }
    return repaired_sections, validation_after_repair, combined_attempts, failure_details


async def _validate_regenerated_section_with_repair(
    *,
    regenerated_section: dict[str, Any],
    base_resume_content: str,
    generation_settings: dict[str, Any],
    professional_experience_anchors: Optional[list[dict[str, Any]]],
    prompt: list[tuple[str, str]],
    section_name: str,
    operation: str,
    model: str,
    fallback_model: str,
    model_used: str,
    attempt_diagnostics: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    reasoning_effort: str = "none",
    fallback_reasoning_effort: str = "none",
    repair_deadline: float,
    on_progress,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], Optional[dict[str, Any]]]:
    aggressiveness = str(generation_settings.get("aggressiveness", "medium")).lower()
    single_section_prefs = [{"name": section_name, "enabled": True, "order": 0}]
    validation_result = await validate_resume(
        generated_sections=[regenerated_section],
        base_resume_content=base_resume_content,
        section_preferences=single_section_prefs,
        generation_settings=generation_settings,
        professional_experience_anchors=professional_experience_anchors,
        length_validation_mode="section",
    )
    if validation_result["valid"]:
        return regenerated_section, validation_result, attempt_diagnostics, None

    await on_progress(78, f"Validation failed for {section_name}. Attempting one repair pass")
    remaining_timeout_seconds = max(0.0, repair_deadline - perf_counter())
    repaired_payload, repair_model, repair_attempts, repair_error = await repair_generated_response(
        prompt=prompt,
        response_model=RegeneratedSectionPayload,
        expected_section_ids=[section_name],
        operation=operation,
        validation_errors=validation_result["errors"],
        prior_response=_build_section_response_payload(regenerated_section),
        model=model,
        fallback_model=fallback_model,
        model_used=model_used,
        prior_attempts=attempt_diagnostics,
        api_key=api_key,
        base_url=base_url,
        timeout=remaining_timeout_seconds,
        aggressiveness=aggressiveness,
        reasoning_effort=reasoning_effort,
        fallback_reasoning_effort=fallback_reasoning_effort,
    )
    combined_attempts = [*attempt_diagnostics, *_sanitize_attempts(repair_attempts)]
    if repair_error is not None or repaired_payload is None:
        failure_details = {
            "failure_stage": "repair",
            "attempt_count": len(combined_attempts),
            "attempts": combined_attempts,
            "repair_model": repair_model,
            "repair_error": _sanitize_error(repair_error or RuntimeError("Unknown repair failure")),
            "terminal_error_code": "validation_failed",
        }
        return regenerated_section, validation_result, combined_attempts, failure_details

    repaired_section = render_semantic_section(
        repaired_payload.section,
        professional_experience_anchors=professional_experience_anchors or [],
        aggressiveness=aggressiveness,
    )
    repaired_section["professional_experience_anchors"] = professional_experience_anchors
    validation_after_repair = await validate_resume(
        generated_sections=[repaired_section],
        base_resume_content=base_resume_content,
        section_preferences=single_section_prefs,
        generation_settings=generation_settings,
        professional_experience_anchors=professional_experience_anchors,
        length_validation_mode="section",
    )
    if validation_after_repair["valid"]:
        return repaired_section, validation_after_repair, combined_attempts, None

    failure_details = {
        "failure_stage": "validation",
        "attempt_count": len(combined_attempts),
        "attempts": combined_attempts,
        "repair_model": repair_model,
        "terminal_error_code": "validation_failed",
    }
    return repaired_section, validation_after_repair, combined_attempts, failure_details


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
    generation_model, generation_fallback_model = _resolve_generation_models(generation_settings, settings)
    generation_reasoning_effort, generation_fallback_reasoning_effort = _resolve_generation_reasoning_efforts(
        generation_settings,
        settings,
    )
    public_generation_settings = {
        key: value for key, value in generation_settings.items() if not str(key).startswith("_")
    }
    attempt_diagnostics: list[dict[str, Any]] = []
    length_diagnostics: Optional[dict[str, Any]] = None

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured.")

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
        job_started_at = perf_counter()
        _log_generation_event(
            "job_start",
            workflow_kind="generation",
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            model=generation_model,
            fallback_model=generation_fallback_model,
            section_count=len(section_preferences),
            job_description_chars=len(job_description),
            base_resume_chars=len(base_resume_content),
        )
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
        # The application is already marked active before queueing, so blocking on
        # a best-effort started callback only adds latency when callback delivery
        # is slow or unavailable.
        # 2. Generate sections (10-80%)
        gen_result = await asyncio.wait_for(
            generate_sections(
                base_resume_content=base_resume_content,
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                section_preferences=section_preferences,
                generation_settings={**public_generation_settings, "_operation": "generation"},
                model=generation_model,
                fallback_model=generation_fallback_model,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                on_progress=on_generation_progress,
                reasoning_effort=generation_reasoning_effort,
                fallback_reasoning_effort=generation_fallback_reasoning_effort,
            ),
            timeout=FULL_GENERATION_MAX_TIMEOUT_SECONDS,
        )
        attempt_diagnostics = _sanitize_attempts(gen_result.get("attempt_diagnostics"))
        _log_generation_event(
            "llm_attempts_completed",
            workflow_kind="generation",
            application_id=application_id,
            job_id=job_id,
            attempt_count=len(attempt_diagnostics),
            attempts=attempt_diagnostics,
            model_used=gen_result.get("model_used"),
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

        generated_sections, validation_result, attempt_diagnostics, repair_failure_details = await _validate_generated_sections_with_repair(
            generated_sections=generated_sections,
            base_resume_content=base_resume_content,
            section_preferences=gen_result.get("eligible_section_preferences") or section_preferences,
            generation_settings=public_generation_settings,
            professional_experience_anchors=gen_result.get("professional_experience_anchors"),
            prompt=gen_result["prompt"],
            section_ids=gen_result["section_ids"],
            operation=gen_result["operation"],
            model=generation_model,
            fallback_model=generation_fallback_model,
            model_used=gen_result["model_used"],
            attempt_diagnostics=attempt_diagnostics,
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            reasoning_effort=generation_reasoning_effort,
            fallback_reasoning_effort=generation_fallback_reasoning_effort,
            repair_deadline=job_started_at + FULL_GENERATION_MAX_TIMEOUT_SECONDS,
            on_progress=on_generation_progress,
        )
        if not await is_current_job(writer, application_id, job_id):
            return

        if not validation_result["valid"]:
            length_diagnostics = _build_length_diagnostics(
                generated_sections=generated_sections,
                base_resume_content=base_resume_content,
                generation_settings=public_generation_settings,
            )
            failure_details = {
                "failure_stage": "validation",
                "attempt_count": len(attempt_diagnostics),
                "attempts": attempt_diagnostics,
                "terminal_error_code": "validation_failed",
                "length_diagnostics": length_diagnostics,
            }
            if repair_failure_details:
                failure_details.update(repair_failure_details)
            _log_generation_event(
                "validation_failed",
                workflow_kind="generation",
                application_id=application_id,
                job_id=job_id,
                attempt_count=len(attempt_diagnostics),
                validation_error_count=len(validation_result["errors"]),
                failure_stage=failure_details.get("failure_stage"),
            )
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
                quota_period_start=_quota_period_start(generation_settings),
            )
            await post_callback_best_effort(
                callback,
                build_generation_failure_payload(
                    application_id=application_id,
                    user_id=user_id,
                    job_id=job_id,
                    message="Resume validation failed.",
                    terminal_error_code="validation_failed",
                    failure_details=failure_details,
                    validation_errors=validation_result["errors"],
                    quota_period_start=_quota_period_start(generation_settings),
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
        length_diagnostics = _build_length_diagnostics(
            generated_sections=generated_sections,
            base_resume_content=base_resume_content,
            generation_settings=public_generation_settings,
        )
        if not await is_current_job(writer, application_id, job_id):
            return

        effective_section_preferences = gen_result.get("eligible_section_preferences") or section_preferences
        enabled_ordered = sorted(
            [s for s in effective_section_preferences if s.get("enabled")],
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
            generation_params=_stored_generation_settings(
                generation_settings,
                model_used=str(gen_result.get("model_used") or ""),
            ),
            sections_snapshot={
                "enabled_sections": [s["name"] for s in enabled_ordered],
                "section_order": [s["name"] for s in enabled_ordered],
            },
            attempts=attempt_diagnostics,
            length_diagnostics=length_diagnostics,
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
        _log_generation_event(
            "job_succeeded",
            workflow_kind="generation",
            application_id=application_id,
            job_id=job_id,
            attempt_count=len(attempt_diagnostics),
            attempts=attempt_diagnostics,
        )

    except asyncio.TimeoutError:
        if not await is_current_job(writer, application_id, job_id):
            return
        failure_details = {
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=generation_model,
                fallback_model=generation_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "terminal_error_code": "generation_timeout",
        }
        _log_generation_event(
            "job_timeout",
            workflow_kind="generation",
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_details["failure_stage"],
            attempts=attempt_diagnostics,
        )
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
            quota_period_start=_quota_period_start(generation_settings),
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Resume generation timed out. The LLM provider may be slow. Please try again.",
                terminal_error_code="generation_timeout",
                failure_details=failure_details,
                quota_period_start=_quota_period_start(generation_settings),
            ),
            path=GENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="generation failed",
        )
        raise
    except Exception as error:
        if not await is_current_job(writer, application_id, job_id):
            return
        failure_details = {
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=generation_model,
                fallback_model=generation_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "terminal_error_code": "generation_error",
            "error": _sanitize_error(error),
        }
        _log_generation_event(
            "job_failed",
            workflow_kind="generation",
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_details["failure_stage"],
            error=_sanitize_error(error),
            attempts=attempt_diagnostics,
        )
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
            quota_period_start=_quota_period_start(generation_settings),
        )
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message="Resume generation failed unexpectedly.",
                terminal_error_code="generation_error",
                failure_details=failure_details,
                quota_period_start=_quota_period_start(generation_settings),
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
    generation_model, generation_fallback_model = _resolve_generation_models(generation_settings, settings)
    generation_reasoning_effort, generation_fallback_reasoning_effort = _resolve_generation_reasoning_efforts(
        generation_settings,
        settings,
    )
    public_generation_settings = {
        key: value for key, value in generation_settings.items() if not str(key).startswith("_")
    }
    attempt_diagnostics: list[dict[str, Any]] = []
    length_diagnostics: Optional[dict[str, Any]] = None

    enabled_ordered = sorted(
        [s for s in section_preferences if s.get("enabled")],
        key=lambda s: s.get("order", 0),
    )
    sections_snapshot = {
        "enabled_sections": [s["name"] for s in enabled_ordered],
        "section_order": [s["name"] for s in enabled_ordered],
    }

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured.")

    is_keyword_optimization = regeneration_target == "keyword_optimization"
    is_full_regen = regeneration_target in {"full", "keyword_optimization"}
    workflow_kind = "regeneration_full" if is_full_regen else "regeneration_section"
    workflow_state = "regenerating_full" if is_full_regen else "regenerating_section"
    section_name = None if is_full_regen else regeneration_target
    instructions = None if is_full_regen else regeneration_instructions
    quota_period_start = _quota_period_start(generation_settings)

    async def _post_regeneration_failure_callback(
        *,
        message: str,
        terminal_error_code: str,
        failure_details: Optional[dict[str, Any]] = None,
        validation_errors: Optional[list[Any]] = None,
    ) -> None:
        await post_callback_best_effort(
            callback,
            build_generation_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                message=message,
                terminal_error_code=terminal_error_code,
                failure_details=failure_details,
                validation_errors=validation_errors,
                quota_period_start=quota_period_start,
                regeneration_target=regeneration_target,
            ),
            path=REGENERATION_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="regeneration failed",
        )

    try:
        job_started_at = perf_counter()
        _log_generation_event(
            "job_start",
            workflow_kind=workflow_kind,
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            regeneration_target=regeneration_target,
            model=generation_model,
            fallback_model=generation_fallback_model,
            job_description_chars=len(job_description),
            base_resume_chars=len(base_resume_content),
        )
        await writer.clear_generation_result(application_id)
        await set_progress(
            writer,
            application_id,
            job_id=job_id,
            workflow_kind=workflow_kind,
            state=workflow_state,
            message=(
                "Preparing keyword optimization inputs"
                if is_keyword_optimization
                else "Preparing regeneration inputs and section plan"
            ),
            percent_complete=5,
        )

        if is_full_regen:
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
                    generation_settings={
                        **public_generation_settings,
                        "_operation": "keyword_optimization" if is_keyword_optimization else "regeneration_full",
                        "_current_draft_snapshot_content": generation_settings.get("_current_draft_snapshot_content"),
                    },
                    model=generation_model,
                    fallback_model=generation_fallback_model,
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                    on_progress=on_regen_progress,
                    reasoning_effort=generation_reasoning_effort,
                    fallback_reasoning_effort=generation_fallback_reasoning_effort,
                ),
                timeout=FULL_GENERATION_MAX_TIMEOUT_SECONDS,
            )
            attempt_diagnostics = _sanitize_attempts(gen_result.get("attempt_diagnostics"))
            _log_generation_event(
                "llm_attempts_completed",
                workflow_kind=workflow_kind,
                application_id=application_id,
                job_id=job_id,
                attempt_count=len(attempt_diagnostics),
                attempts=attempt_diagnostics,
                model_used=gen_result.get("model_used"),
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
            generated_sections, validation_result, attempt_diagnostics, repair_failure_details = await _validate_generated_sections_with_repair(
                generated_sections=generated_sections,
                base_resume_content=base_resume_content,
                section_preferences=gen_result.get("eligible_section_preferences") or section_preferences,
                generation_settings=public_generation_settings,
                professional_experience_anchors=gen_result.get("professional_experience_anchors"),
                prompt=gen_result["prompt"],
                section_ids=gen_result["section_ids"],
                operation=gen_result["operation"],
                model=generation_model,
                fallback_model=generation_fallback_model,
                model_used=gen_result["model_used"],
                attempt_diagnostics=attempt_diagnostics,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                reasoning_effort=generation_reasoning_effort,
                fallback_reasoning_effort=generation_fallback_reasoning_effort,
                repair_deadline=job_started_at + FULL_GENERATION_MAX_TIMEOUT_SECONDS,
                on_progress=on_regen_progress,
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            if not validation_result["valid"]:
                length_diagnostics = _build_length_diagnostics(
                    generated_sections=generated_sections,
                    base_resume_content=base_resume_content,
                    generation_settings=public_generation_settings,
                )
                failure_details = {
                    "failure_stage": "validation",
                    "attempt_count": len(attempt_diagnostics),
                    "attempts": attempt_diagnostics,
                    "terminal_error_code": "validation_failed",
                    "length_diagnostics": length_diagnostics,
                }
                if repair_failure_details:
                    failure_details.update(repair_failure_details)
                _log_generation_event(
                    "validation_failed",
                    workflow_kind=workflow_kind,
                    application_id=application_id,
                    job_id=job_id,
                    attempt_count=len(attempt_diagnostics),
                    validation_error_count=len(validation_result["errors"]),
                    failure_stage=failure_details.get("failure_stage"),
                )
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
                    quota_period_start=quota_period_start,
                )
                await _post_regeneration_failure_callback(
                    message="Regeneration validation failed.",
                    terminal_error_code="validation_failed",
                    failure_details=failure_details,
                    validation_errors=validation_result["errors"],
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
            length_diagnostics = _build_length_diagnostics(
                generated_sections=generated_sections,
                base_resume_content=base_resume_content,
                generation_settings=public_generation_settings,
            )
            if not await is_current_job(writer, application_id, job_id):
                return
            effective_section_preferences = gen_result.get("eligible_section_preferences") or section_preferences
            enabled_ordered = sorted(
                [s for s in effective_section_preferences if s.get("enabled")],
                key=lambda s: s.get("order", 0),
            )
            sections_snapshot = {
                "enabled_sections": [s["name"] for s in enabled_ordered],
                "section_order": [s["name"] for s in enabled_ordered],
            }
        else:
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
                    model=generation_model,
                    fallback_model=generation_fallback_model,
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                    on_progress=on_section_regen_progress,
                    reasoning_effort=generation_reasoning_effort,
                    fallback_reasoning_effort=generation_fallback_reasoning_effort,
                ),
                timeout=SECTION_REGENERATION_TIMEOUT_SECONDS,
            )
            attempt_diagnostics = _sanitize_attempts(regenerated_section.get("attempt_diagnostics"))
            _log_generation_event(
                "llm_attempts_completed",
                workflow_kind=workflow_kind,
                application_id=application_id,
                job_id=job_id,
                attempt_count=len(attempt_diagnostics),
                attempts=attempt_diagnostics,
                model_used=regenerated_section.get("model_used"),
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            await set_progress(
                writer,
                application_id,
                job_id=job_id,
                workflow_kind=workflow_kind,
                state=workflow_state,
                message=f"Running deterministic validation for regenerated {section_name} section",
                percent_complete=70,
            )
            regenerated_section, validation_result, attempt_diagnostics, repair_failure_details = await _validate_regenerated_section_with_repair(
                regenerated_section=regenerated_section,
                base_resume_content=base_resume_content,
                generation_settings=public_generation_settings,
                professional_experience_anchors=regenerated_section.get("professional_experience_anchors"),
                prompt=regenerated_section["prompt"],
                section_name=section_name,
                operation=regenerated_section["operation"],
                model=generation_model,
                fallback_model=generation_fallback_model,
                model_used=regenerated_section["model_used"],
                attempt_diagnostics=attempt_diagnostics,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                reasoning_effort=generation_reasoning_effort,
                fallback_reasoning_effort=generation_fallback_reasoning_effort,
                repair_deadline=job_started_at + SECTION_REGENERATION_TIMEOUT_SECONDS,
                on_progress=on_section_regen_progress,
            )
            if not await is_current_job(writer, application_id, job_id):
                return

            if not validation_result["valid"]:
                failure_details = {
                    "failure_stage": "validation",
                    "attempt_count": len(attempt_diagnostics),
                    "attempts": attempt_diagnostics,
                    "terminal_error_code": "validation_failed",
                }
                if repair_failure_details:
                    failure_details.update(repair_failure_details)
                _log_generation_event(
                    "validation_failed",
                    workflow_kind=workflow_kind,
                    application_id=application_id,
                    job_id=job_id,
                    attempt_count=len(attempt_diagnostics),
                    validation_error_count=len(validation_result["errors"]),
                    failure_stage=failure_details.get("failure_stage"),
                )
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
                    quota_period_start=quota_period_start,
                )
                await _post_regeneration_failure_callback(
                    message=f"Validation failed for regenerated {section_name} section.",
                    terminal_error_code="validation_failed",
                    failure_details=failure_details,
                    validation_errors=validation_result["errors"],
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
            display_name = SECTION_DISPLAY_NAMES.get(
                section_name, section_name.replace("_", " ").title()
            )
            content = _replace_section_in_draft(
                current_draft_content, section_name, regenerated_section["content"], display_name
            )

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
            generation_params=_stored_generation_settings(
                generation_settings,
                model_used=str(
                    (gen_result if is_full_regen else regenerated_section).get("model_used") or ""
                ),
            ),
            sections_snapshot=sections_snapshot,
            regeneration_target=regeneration_target,
            attempts=attempt_diagnostics,
            length_diagnostics=length_diagnostics,
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
        _log_generation_event(
            "job_succeeded",
            workflow_kind=workflow_kind,
            application_id=application_id,
            job_id=job_id,
            attempt_count=len(attempt_diagnostics),
            attempts=attempt_diagnostics,
        )

    except asyncio.TimeoutError:
        if not await is_current_job(writer, application_id, job_id):
            return
        failure_details = {
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=generation_model,
                fallback_model=generation_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "terminal_error_code": "regeneration_timeout",
        }
        _log_generation_event(
            "job_timeout",
            workflow_kind=workflow_kind,
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_details["failure_stage"],
            attempts=attempt_diagnostics,
        )
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
            quota_period_start=quota_period_start,
        )
        await _post_regeneration_failure_callback(
            message="Regeneration timed out. The LLM provider may be slow. Please try again.",
            terminal_error_code="regeneration_timeout",
            failure_details=failure_details,
        )
        raise
    except Exception as error:
        if not await is_current_job(writer, application_id, job_id):
            return
        failure_details = {
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=generation_model,
                fallback_model=generation_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "terminal_error_code": "regeneration_error",
            "error": _sanitize_error(error),
        }
        _log_generation_event(
            "job_failed",
            workflow_kind=workflow_kind,
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_details["failure_stage"],
            error=_sanitize_error(error),
            attempts=attempt_diagnostics,
        )
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
            quota_period_start=quota_period_start,
        )
        await _post_regeneration_failure_callback(
            message="Regeneration failed unexpectedly.",
            terminal_error_code="regeneration_error",
            failure_details=failure_details,
        )
        raise


async def run_resume_judge_job(
    ctx: dict[str, Any],
    *,
    application_id: str,
    user_id: str,
    job_id: str,
    job_title: str,
    company_name: Optional[str],
    job_description: str,
    base_resume_content: str,
    generated_resume_content: str,
    generation_settings: dict[str, Any],
    evaluated_draft_updated_at: str,
    job_context_signature: str,
    input_signature: str,
) -> None:
    settings = WorkerSettingsEnv()
    callback = BackendCallbackClient(settings)
    attempt_diagnostics: list[dict[str, Any]] = []

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured.")
    if not settings.resume_judge_agent_model:
        raise RuntimeError("RESUME_JUDGE_AGENT_MODEL is not configured.")
    if not settings.resume_judge_agent_fallback_model:
        raise RuntimeError("RESUME_JUDGE_AGENT_FALLBACK_MODEL is not configured.")

    await post_callback_best_effort(
        callback,
        {
            "application_id": application_id,
            "user_id": user_id,
            "job_id": job_id,
            "event": "started",
            "evaluated_draft_updated_at": evaluated_draft_updated_at,
            "job_context_signature": job_context_signature,
            "input_signature": input_signature,
        },
        path=RESUME_JUDGE_CALLBACK_PATH,
        app_id=application_id,
        job_id=job_id,
        callback_stage="resume judge started",
    )

    try:
        _log_generation_event(
            "job_start",
            workflow_kind="resume_judge",
            application_id=application_id,
            user_id=user_id,
            job_id=job_id,
            model=settings.resume_judge_agent_model,
            fallback_model=settings.resume_judge_agent_fallback_model,
            target_length=generation_settings.get("page_length"),
            aggressiveness=generation_settings.get("aggressiveness"),
        )
        judge_result = await asyncio.wait_for(
            judge_resume(
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                base_resume_content=base_resume_content,
                generated_resume_content=generated_resume_content,
                aggressiveness=str(generation_settings.get("aggressiveness") or "medium"),
                target_length=str(generation_settings.get("page_length") or "1_page"),
                model=settings.resume_judge_agent_model,
                fallback_model=settings.resume_judge_agent_fallback_model,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                reasoning_effort=settings.resume_judge_agent_reasoning_effort,
                evaluated_draft_updated_at=evaluated_draft_updated_at,
                scored_at=now_iso(),
                timeout=RESUME_JUDGE_TIMEOUT_SECONDS,
            ),
            timeout=RESUME_JUDGE_TIMEOUT_SECONDS,
        )
        attempt_diagnostics = _sanitize_attempts(judge_result.get("attempt_diagnostics"))
        resume_judge_result = dict(judge_result["resume_judge_result"])
        resume_judge_result["job_context_signature"] = job_context_signature
        resume_judge_result["input_signature"] = input_signature
        resume_judge_result["attempts"] = attempt_diagnostics
        resume_judge_result["attempt_count"] = len(attempt_diagnostics)
        _log_generation_event(
            "llm_attempts_completed",
            workflow_kind="resume_judge",
            application_id=application_id,
            job_id=job_id,
            attempt_count=len(attempt_diagnostics),
            attempts=attempt_diagnostics,
            model_used=judge_result.get("model_used"),
        )
        await post_callback_best_effort(
            callback,
            build_resume_judge_success_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                evaluated_draft_updated_at=evaluated_draft_updated_at,
                input_signature=input_signature,
                resume_judge_result=resume_judge_result,
            ),
            path=RESUME_JUDGE_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="resume judge succeeded",
        )
        _log_generation_event(
            "job_succeeded",
            workflow_kind="resume_judge",
            application_id=application_id,
            job_id=job_id,
            attempt_count=len(attempt_diagnostics),
            attempts=attempt_diagnostics,
        )
    except asyncio.TimeoutError as error:
        failure_result = {
            "status": "failed",
            "message": "Resume Judge timed out. Score unavailable.",
            "evaluated_draft_updated_at": evaluated_draft_updated_at,
            "scored_at": now_iso(),
            "job_context_signature": job_context_signature,
            "input_signature": input_signature,
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=settings.resume_judge_agent_model,
                fallback_model=settings.resume_judge_agent_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "error": _sanitize_error(error),
        }
        _log_generation_event(
            "job_timeout",
            workflow_kind="resume_judge",
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_result["failure_stage"],
            attempts=attempt_diagnostics,
        )
        await post_callback_best_effort(
            callback,
            build_resume_judge_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                evaluated_draft_updated_at=evaluated_draft_updated_at,
                input_signature=input_signature,
                resume_judge_result=failure_result,
            ),
            path=RESUME_JUDGE_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="resume judge failed",
        )
        raise
    except Exception as error:
        failure_result = {
            "status": "failed",
            "message": "Resume Judge failed. Score unavailable.",
            "evaluated_draft_updated_at": evaluated_draft_updated_at,
            "scored_at": now_iso(),
            "job_context_signature": job_context_signature,
            "input_signature": input_signature,
            "failure_stage": _llm_failure_stage_from_attempts(
                attempt_diagnostics,
                primary_model=settings.resume_judge_agent_model,
                fallback_model=settings.resume_judge_agent_fallback_model,
            ),
            "attempt_count": len(attempt_diagnostics),
            "attempts": attempt_diagnostics,
            "error": _sanitize_error(error),
        }
        _log_generation_event(
            "job_failed",
            workflow_kind="resume_judge",
            application_id=application_id,
            job_id=job_id,
            failure_stage=failure_result["failure_stage"],
            error=_sanitize_error(error),
            attempts=attempt_diagnostics,
        )
        await post_callback_best_effort(
            callback,
            build_resume_judge_failure_payload(
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                evaluated_draft_updated_at=evaluated_draft_updated_at,
                input_signature=input_signature,
                resume_judge_result=failure_result,
            ),
            path=RESUME_JUDGE_CALLBACK_PATH,
            app_id=application_id,
            job_id=job_id,
            callback_stage="resume judge failed",
        )
        raise


class WorkerSettings:
    functions = [
        report_bootstrap_progress,
        run_extraction_job,
        run_generation_job,
        run_keyword_extraction_job,
        run_regeneration_job,
        run_resume_judge_job,
    ]
    redis_settings = RedisSettings.from_dsn(WorkerSettingsEnv().redis_url)
    max_tries = 1
