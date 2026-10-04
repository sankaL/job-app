"""LangSmith tracing helpers for backend-owned LLM calls."""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import lru_cache
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


@dataclass(frozen=True)
class TraceConfig:
    enabled: bool = False
    api_key: Optional[str] = field(default=None, repr=False)
    project_name: Optional[str] = None
    workspace_id: Optional[str] = None
    # Redacted prompt/output bodies are an explicit opt-in on top of tracing.
    content_enabled: bool = False

    @property
    def include_content(self) -> bool:
        return self.enabled and self.content_enabled


@lru_cache(maxsize=4)
def _build_client(api_key: str, workspace_id: Optional[str] = None) -> Client:
    return Client(api_key=api_key, workspace_id=workspace_id, anonymizer=_anonymizer, timeout_ms=5000)


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
                in {"api_key", "authorization", "auth_token", "access_token", "secret", "user_id", "personal_info", "callback_payload", "raw_callback"}
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
        outputs = kwargs.get("outputs")
        if isinstance(outputs, dict):
            usage = {key: outputs[key] for key in ("input_tokens", "output_tokens")
                if type(outputs.get(key)) is int and outputs[key] >= 0}
            if usage:
                if len(usage) == 2:
                    usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
                kwargs["outputs"] = {**outputs, "usage_metadata": usage}
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
    run_type: str = "llm",
    workspace_id: Optional[str] = None,
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
        if run_type == "llm" and metadata.get("model"):
            metadata = {**metadata, "ls_provider": "openrouter",
                "ls_model_name": metadata["model"], "ls_model_type": "chat"}
        client = _build_client(api_key.strip(), str(workspace_id or "").strip() or None)
        tracing_manager = tracing_context(
            enabled=True,
            client=client,
            project_name=project_name.strip(),
            tags=["applix", str(metadata.get("operation", "resume_import"))],
            metadata=sanitize_trace_data(metadata),
        )
        tracing_manager.__enter__()
        run_manager = trace(
            name,
            run_type=run_type,
            inputs=sanitize_trace_data(inputs),
            metadata=sanitize_trace_data(metadata),
            tags=["applix", str(metadata.get("operation", "resume_import"))],
            client=client,
            project_name=project_name.strip(),
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
        end_trace_safely(run_tree, error=type(error).__name__)
        raise
    finally:
        # SDK exception formatting includes provider bodies and traceback locals.
        # Preserve the original exception for the caller, but send only its type.
        try:
            if run_manager is not None:
                run_manager.__exit__(None, None, None)
        except Exception as error:
            if operation_error is None:
                logger.warning("LangSmith trace finalization failed. error_type=%s", type(error).__name__)
        try:
            if tracing_manager is not None:
                tracing_manager.__exit__(None, None, None)
        except Exception as error:
            if operation_error is None:
                logger.warning("LangSmith context finalization failed. error_type=%s", type(error).__name__)
