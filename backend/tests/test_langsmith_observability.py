from __future__ import annotations

"""Backend LangSmith and prompt-policy regression coverage."""

import hashlib
import importlib.util
import json
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.tracing import sanitize_trace_data
from app.services import resume_parser
from app.services.resume_parser import ResumeParserService
from app.services.unslop_prompt import UNSLOP_INSTRUCTION, UNSLOP_PRECEDENCE


EXPECTED_UNSLOP_SHA256 = "0a04c5bc42b4882a71ef4e5f2a38e8dcf89faba73a07285f652c22b15f5228cb"


def test_backend_and_agents_unslop_policies_are_identical():
    agents_policy_path = Path(__file__).resolve().parents[2] / "agents" / "unslop_prompt.py"
    spec = importlib.util.spec_from_file_location("agents_unslop_policy_for_test", agents_policy_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.UNSLOP_INSTRUCTION == UNSLOP_INSTRUCTION
    assert module.UNSLOP_PRECEDENCE == UNSLOP_PRECEDENCE
    assert hashlib.sha256(UNSLOP_INSTRUCTION.encode()).hexdigest() == EXPECTED_UNSLOP_SHA256


def test_backend_trace_sanitizer_removes_contacts_secrets_and_url_queries():
    sanitized = sanitize_trace_data(
        {
            "user_id": "user-123",
            "text": (
                "alex@example.com +1 416 555 0100 Bearer token-value "
                "https://example.com/path?access_token=secret#fragment api_key=abc123"
            ),
        }
    )
    serialized = str(sanitized)
    assert "user-123" not in serialized
    assert "alex@example.com" not in serialized
    assert "416" not in serialized
    assert "token-value" not in serialized
    assert "access_token=secret" not in serialized
    assert "abc123" not in serialized
    assert "https://example.com/path" in serialized


def test_backend_settings_require_langsmith_credentials_when_enabled(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "key")
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)
    with pytest.raises(ValueError, match="LANGSMITH_PROJECT"):
        Settings()

    monkeypatch.setenv("LANGSMITH_PROJECT", "project")
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    with pytest.raises(ValueError, match="LANGSMITH_API_KEY"):
        Settings()

    monkeypatch.setenv("LANGSMITH_API_KEY", "key")
    assert Settings().langsmith_project == "project"


@pytest.mark.asyncio
async def test_cleanup_traces_only_sanitized_content_and_unslop_prompt(monkeypatch):
    captured = {}

    @contextmanager
    def fake_trace_scope(**kwargs):
        captured.update(kwargs)

        class FakeRun:
            def end(self, **end_kwargs):
                captured["end"] = end_kwargs

        yield FakeRun()

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "cleaned_markdown": "## Summary\nBuilt APIs.",
                                    "needs_review": False,
                                    "review_reason": None,
                                }
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            }

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(resume_parser, "trace_llm_scope", fake_trace_scope)
    monkeypatch.setattr(resume_parser.httpx, "AsyncClient", FakeAsyncClient)
    service = ResumeParserService(
        openrouter_api_key="openrouter-key",
        openrouter_model="model",
        langsmith_tracing=True,
        langsmith_project="project",
        langsmith_api_key="langsmith-key",
    )

    result = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | +1 416 555 0100\n\n## Summary\nBuilt APIs."
    )

    traced_messages = captured["inputs"]["messages"]
    assert UNSLOP_PRECEDENCE in traced_messages[0]["content"]
    assert UNSLOP_INSTRUCTION in traced_messages[0]["content"]
    assert "alex@example.com" not in str(traced_messages)
    assert "416" not in str(traced_messages)
    assert captured["name"] == "applix.resume_cleanup"
    assert captured["end"]["metadata"]["provider_usage"]["prompt_tokens"] == 10
    assert result.cleaned_markdown.startswith("Alex Example")
