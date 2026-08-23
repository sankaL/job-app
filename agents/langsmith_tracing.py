"""LangSmith tracing helpers that keep private workflow data out of telemetry."""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from functools import lru_cache, wraps
from typing import Any, Callable, Iterator, Mapping, Optional, Union
from urllib.parse import urlsplit, urlunsplit

from langsmith import Client, get_current_run_tree, trace, tracing_context
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d .()\-]{7,}\d)(?!\w)")
BEARER_RE = re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+")
SECRET_RE = re.compile(
    r"(?i)((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret)\s*[=:]\s*)[^\s,;]+"
)
OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{10,}\b")
URL_RE = re.compile(r"https?://[^\s\"'<>,]+", re.I)
CONTACT_PROFILE_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:(?:linkedin|github|gitlab|behance|dribbble)\.com|(?:[^\s/]+\.)?portfolio\.[^\s/]+)/[^\s\"'<>,]+",
    re.I,
)
SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "auth_token",
    "access_token",
    "secret",
    "user_id",
    "personal_info",
    "raw_callback",
    "callback_payload",
}


class _TraceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    langsmith_tracing: bool = False
    langsmith_project: Optional[str] = None
    langsmith_api_key: Optional[str] = None


def _sanitize_url(value: str) -> str:
    if not value.lower().startswith(("http://", "https://")):
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def _sanitize_string(value: str) -> str:
    sanitized = EMAIL_RE.sub("<email-address>", value)
    sanitized = PHONE_RE.sub("<phone-number>", sanitized)
    sanitized = BEARER_RE.sub(r"\1<redacted>", sanitized)
    sanitized = SECRET_RE.sub(r"\1<redacted>", sanitized)
    sanitized = OPENAI_KEY_RE.sub("<api-key>", sanitized)
    sanitized = CONTACT_PROFILE_URL_RE.sub("<profile-url>", sanitized)
    sanitized = URL_RE.sub(lambda match: _sanitize_url(match.group(0)), sanitized)
    return sanitized


def sanitize_trace_data(value: Any, *, depth: int = 12) -> Any:
    if depth <= 0:
        return "<max-depth>"
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = str(key).strip().lower()
            sanitized[str(key)] = (
                "<redacted>"
                if normalized_key in SENSITIVE_KEYS
                else sanitize_trace_data(item, depth=depth - 1)
            )
        return sanitized
    if isinstance(value, (list, tuple, set)):
        return [sanitize_trace_data(item, depth=depth - 1) for item in value]
    if isinstance(value, str):
        return _sanitize_string(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


def _trace_anonymizer(value: dict) -> dict:
    sanitized = sanitize_trace_data(value)
    return sanitized if isinstance(sanitized, dict) else {}


@lru_cache(maxsize=4)
def _build_client(api_key: str, project_name: str) -> Client:
    del project_name
    return Client(api_key=api_key, anonymizer=_trace_anonymizer)


def _trace_config() -> tuple[bool, Optional[str], Optional[str]]:
    settings = _TraceSettings()
    if not settings.langsmith_tracing:
        return False, None, None
    api_key = str(settings.langsmith_api_key or "").strip()
    project_name = str(settings.langsmith_project or "").strip()
    if not api_key:
        raise RuntimeError("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.")
    if not project_name:
        raise RuntimeError("LANGSMITH_PROJECT is required when LANGSMITH_TRACING=true.")
    return True, api_key, project_name


@contextmanager
def trace_scope(
    name: str,
    *,
    run_type: str = "chain",
    inputs: Optional[dict[str, Any]] = None,
    metadata: Optional[dict[str, Any]] = None,
    tags: Optional[list[str]] = None,
) -> Iterator[Any]:
    enabled, api_key, project_name = _trace_config()
    if not enabled:
        yield None
        return

    client = None
    tracing_manager = None
    run_manager = None
    run_tree = None
    operation_error: Optional[BaseException] = None
    try:
        client = _build_client(str(api_key), str(project_name))
        tracing_manager = tracing_context(
            enabled=True,
            client=client,
            project_name=project_name,
            tags=tags,
            metadata=sanitize_trace_data(metadata or {}),
        )
        tracing_manager.__enter__()
        run_manager = trace(
            name,
            run_type=run_type,
            inputs=sanitize_trace_data(inputs or {}),
            metadata=sanitize_trace_data(metadata or {}),
            tags=tags,
            client=client,
            project_name=project_name,
        )
        run_tree = run_manager.__enter__()
    except Exception as error:
        logger.warning("LangSmith trace setup failed; continuing without telemetry. error_type=%s", type(error).__name__)
        if tracing_manager is not None:
            try:
                tracing_manager.__exit__(None, None, None)
            except Exception:
                pass
        yield None
        return

    try:
        yield run_tree
    except BaseException as error:
        operation_error = error
        raise
    finally:
        error_type = type(operation_error) if operation_error is not None else None
        traceback = operation_error.__traceback__ if operation_error is not None else None
        try:
            if run_manager is not None:
                run_manager.__exit__(error_type, operation_error, traceback)
        except Exception as error:
            if operation_error is None:
                logger.warning("LangSmith trace finalization failed. error_type=%s", type(error).__name__)
        try:
            if tracing_manager is not None:
                tracing_manager.__exit__(error_type, operation_error, traceback)
        except Exception as error:
            if operation_error is None:
                logger.warning("LangSmith context finalization failed. error_type=%s", type(error).__name__)


def model_run_config(
    *,
    operation: str,
    model: str,
    transport_mode: str,
    is_fallback: bool,
    reasoning_effort: Optional[str] = None,
    timeout_seconds: Optional[float] = None,
    retry_reason: Optional[str] = None,
    extra_metadata: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    metadata = {
        "operation": operation,
        "model": model,
        "transport_mode": transport_mode,
        "is_fallback": is_fallback,
        "reasoning_effort": reasoning_effort,
        "timeout_seconds": timeout_seconds,
        "retry_reason": retry_reason,
        **dict(extra_metadata or {}),
    }
    return {
        "run_name": f"applix.{operation}.{transport_mode}",
        "tags": ["applix", operation, transport_mode, "fallback" if is_fallback else "primary"],
        "metadata": {key: value for key, value in metadata.items() if value is not None},
    }


def annotate_current_trace(metadata: Mapping[str, Any]) -> None:
    run_tree = get_current_run_tree()
    if run_tree is None:
        return
    run_tree.metadata.update(sanitize_trace_data(dict(metadata)))


def end_trace_safely(run_tree: Any, **kwargs: Any) -> None:
    """Finish telemetry without allowing delivery failures to fail the workflow."""
    if run_tree is None:
        return
    try:
        run_tree.end(**kwargs)
    except Exception as error:
        logger.warning("LangSmith run completion failed; continuing without telemetry. error_type=%s", type(error).__name__)


def _safe_workflow_inputs(kwargs: Mapping[str, Any]) -> dict[str, Any]:
    generation_settings = kwargs.get("generation_settings")
    safe_generation = generation_settings if isinstance(generation_settings, Mapping) else {}
    section_preferences = kwargs.get("section_preferences")
    section_ids = []
    if isinstance(section_preferences, list):
        section_ids = [
            str(item.get("name"))
            for item in section_preferences
            if isinstance(item, Mapping) and item.get("enabled") and item.get("name")
        ]
    return {
        "application_id": kwargs.get("application_id"),
        "job_id": kwargs.get("job_id"),
        "regeneration_target": kwargs.get("regeneration_target"),
        "section_ids": section_ids,
        "aggressiveness": safe_generation.get("aggressiveness"),
        "target_length": safe_generation.get("page_length") or safe_generation.get("target_length"),
        "job_description_chars": len(str(kwargs.get("job_description") or "")),
        "base_resume_chars": len(str(kwargs.get("base_resume_content") or "")),
        "generated_resume_chars": len(str(kwargs.get("generated_resume_content") or "")),
        "source_capture_present": kwargs.get("source_capture") is not None,
    }


def _safe_workflow_output(result: Any) -> dict[str, Any]:
    if not isinstance(result, Mapping):
        return {"status": "completed"}
    return {
        key: result.get(key)
        for key in ("status", "event", "model_used")
        if result.get(key) is not None
    } or {"status": "completed"}


def trace_workflow(name: Union[str, Callable[[Mapping[str, Any]], str]]):
    def decorator(function):
        @wraps(function)
        async def wrapped(*args, **kwargs):
            trace_name = name(kwargs) if callable(name) else name
            with trace_scope(
                trace_name,
                inputs=_safe_workflow_inputs(kwargs),
                metadata={
                    "workflow": trace_name.removeprefix("applix."),
                    "application_id": kwargs.get("application_id"),
                    "job_id": kwargs.get("job_id"),
                },
                tags=["applix", "workflow"],
            ) as run_tree:
                result = await function(*args, **kwargs)
                end_trace_safely(run_tree, outputs=sanitize_trace_data(_safe_workflow_output(result)))
                return result

        return wrapped

    return decorator
