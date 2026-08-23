"""LangSmith tracing helpers for backend-owned LLM calls."""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from typing import Any, Iterator, Optional
from urllib.parse import urlsplit, urlunsplit

from langsmith import Client, trace, tracing_context

from app.services.resume_privacy import EMAIL_RE, PHONE_RE

logger = logging.getLogger(__name__)
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


def _strip_url_secrets(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def sanitize_trace_data(value: Any, *, depth: int = 12) -> Any:
    if depth <= 0:
        return "<max-depth>"
    if isinstance(value, dict):
        return {
            str(key): (
                "<redacted>"
                if str(key).strip().lower()
                in {"api_key", "authorization", "auth_token", "user_id", "personal_info", "callback_payload"}
                else sanitize_trace_data(item, depth=depth - 1)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [sanitize_trace_data(item, depth=depth - 1) for item in value]
    if isinstance(value, str):
        sanitized = PHONE_RE.sub("<phone-number>", EMAIL_RE.sub("<email-address>", value))
        sanitized = BEARER_RE.sub(r"\1<redacted>", sanitized)
        sanitized = SECRET_RE.sub(r"\1<redacted>", sanitized)
        sanitized = OPENAI_KEY_RE.sub("<api-key>", sanitized)
        sanitized = CONTACT_PROFILE_URL_RE.sub("<profile-url>", sanitized)
        return URL_RE.sub(lambda match: _strip_url_secrets(match.group(0)), sanitized)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


def _anonymizer(value: dict) -> dict:
    sanitized = sanitize_trace_data(value)
    return sanitized if isinstance(sanitized, dict) else {}


def end_trace_safely(run_tree: Any, **kwargs: Any) -> None:
    """Finish telemetry without allowing delivery failures to fail cleanup."""
    if run_tree is None:
        return
    try:
        run_tree.end(**kwargs)
    except Exception as error:
        logger.warning("LangSmith run completion failed; continuing without telemetry. error_type=%s", type(error).__name__)


@contextmanager
def trace_llm_scope(
    *,
    enabled: bool,
    api_key: Optional[str],
    project_name: Optional[str],
    name: str,
    inputs: dict[str, Any],
    metadata: dict[str, Any],
) -> Iterator[Any]:
    if not enabled:
        yield None
        return
    if not api_key or not api_key.strip():
        raise RuntimeError("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.")
    if not project_name or not project_name.strip():
        raise RuntimeError("LANGSMITH_PROJECT is required when LANGSMITH_TRACING=true.")

    client = None
    tracing_manager = None
    run_manager = None
    run_tree = None
    operation_error: Optional[BaseException] = None
    try:
        client = Client(api_key=api_key, anonymizer=_anonymizer)
        tracing_manager = tracing_context(
            enabled=True,
            client=client,
            project_name=project_name,
            tags=["applix", "resume_cleanup"],
            metadata=sanitize_trace_data(metadata),
        )
        tracing_manager.__enter__()
        run_manager = trace(
            name,
            run_type="llm",
            inputs=sanitize_trace_data(inputs),
            metadata=sanitize_trace_data(metadata),
            tags=["applix", "resume_cleanup"],
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
