from __future__ import annotations

"""Backend LangSmith and prompt-policy regression coverage."""

import json
from contextlib import contextmanager

import pytest

from app.core.config import Settings
from app.core.tracing import end_trace_safely, sanitize_trace_data
from app.services import resume_parser
from app.services.resume_parser import ResumeParserService


def test_backend_trace_sanitizer_removes_contacts_secrets_and_url_queries():
    sanitized = sanitize_trace_data(
        {
            "user_id": "user-123",
            "text": (
                "alex@example.com +1 416 555 0100 Bearer token-value "
                "https://example.com/path?access_token=secret#fragment "
                "https://github.com/alex-example api_key=abc123"
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
    assert "alex-example" not in serialized
    assert "https://example.com/path" in serialized
    assert "<profile-url>" in serialized


def test_trace_completion_failure_is_best_effort():
    class FailingRun:
        def end(self, **_kwargs):
            raise RuntimeError("telemetry unavailable")

    end_trace_safely(FailingRun(), outputs={"status": "ok"})


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
async def test_cleanup_traces_only_sanitized_content_without_unslop_prompt(monkeypatch):
    captured = {}

    @contextmanager
    def fake_trace_scope(**kwargs):
        captured.update(kwargs)

        class FakeRun:
            def end(self, **end_kwargs):
                captured["end"] = end_kwargs

        yield FakeRun()

    async def fake_invoke(**kwargs):
        output = resume_parser.CleanupOutput(cleaned_markdown="## Summary\nBuilt APIs.", needs_review=False, review_reason=None)
        kwargs["validator"](output)
        return output

    monkeypatch.setattr(resume_parser, "trace_llm_scope", fake_trace_scope)
    monkeypatch.setattr(resume_parser, "invoke_import_output", fake_invoke)
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
    assert "Unslop" not in traced_messages[0]["content"]
    assert "alex@example.com" not in str(traced_messages)
    assert "416" not in str(traced_messages)
    assert captured["name"] == "applix.resume_cleanup"
    assert "Built APIs" not in str(captured)
    assert captured["end"]["metadata"]["maximum_requests"] == 2
    assert result.cleaned_markdown.startswith("Alex Example")


@pytest.mark.parametrize("enabled", [False, True])
def test_backend_trace_routes_project_and_never_forwards_private_exception(monkeypatch, enabled):
    from app.core import tracing

    captured = []
    class Run:
        def end(self, **kwargs):
            captured.append(kwargs)
    class Manager:
        def __init__(self, value=None):
            self.value = value
        def __enter__(self):
            return self.value
        def __exit__(self, *args):
            captured.append({"exit": args})
    def client(*args):
        assert enabled, "Disabled tracing must never create a client"
        return object()
    def context(**kwargs):
        captured.append({"project_name": kwargs["project_name"], "tags": kwargs["tags"]})
        return Manager()
    def trace(*args, **kwargs):
        captured.append({"project_name": kwargs["project_name"], "tags": kwargs["tags"]})
        return Manager(Run())
    monkeypatch.setattr(tracing, "_build_client", client)
    monkeypatch.setattr(tracing, "tracing_context", context)
    monkeypatch.setattr(tracing, "trace", trace)
    private_error = ValueError("Private raw provider payload")
    with pytest.raises(ValueError) as raised:
        with tracing.trace_llm_scope(enabled=enabled, api_key="test-key", project_name=" project-b ",
            name="applix.resume_entry_extraction", inputs={"section_count": 1},
            metadata={"operation": "resume_entry_extraction"}):
            raise private_error
    assert raised.value is private_error
    if enabled:
        assert captured[0]["project_name"] == "project-b"
        assert captured[0]["tags"] == ["applix", "resume_entry_extraction"]
        assert {"error": "ValueError"} in captured
        assert all(item["exit"] == (None, None, None) for item in captured if "exit" in item)
        assert "Private raw" not in str(captured)
    else:
        assert captured == []


@pytest.mark.asyncio
async def test_nested_extraction_passes_tracing_settings_to_both_models(monkeypatch):
    from app.services.resume_document import ResumeSection

    calls = []
    async def invoke(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("Provider unavailable")
    monkeypatch.setattr(resume_parser, "invoke_import_output", invoke)
    parser = ResumeParserService(openrouter_api_key="provider-key", openrouter_model="primary-model",
        openrouter_fallback_model="fallback-model", langsmith_tracing=True,
        langsmith_api_key="telemetry-key", langsmith_project="applix-dev", langsmith_workspace_id="workspace-test")
    section = ResumeSection(id="experience", kind="professional_experience", heading="Experience",
        content_md="Acme\nEngineer\n2020 - 2024\n- Built APIs.")
    with pytest.raises(RuntimeError):
        await parser._extract_nested_entries([section], timeout_seconds=2)
    assert [call["model"] for call in calls] == ["primary-model", "fallback-model"]
    assert [call["is_fallback"] for call in calls] == [False, True]
    assert all(call["trace_config"].project_name == "applix-dev" for call in calls)
    assert all(call["trace_config"].workspace_id == "workspace-test" for call in calls)
    assert all(call["operation"] == "resume_entry_extraction" for call in calls)


@pytest.mark.asyncio
async def test_import_continues_when_telemetry_client_setup_fails(monkeypatch):
    from app.core import tracing
    from app.core.tracing import TraceConfig
    from app.services import import_ai

    def unavailable(*_args):
        raise RuntimeError("Telemetry unavailable")
    async def invoke(**kwargs):
        return resume_parser.CleanupOutput(cleaned_markdown="## Skills\nPython", needs_review=False, review_reason=None)
    monkeypatch.setattr(tracing, "_build_client", unavailable)
    monkeypatch.setattr(import_ai, "_invoke_import_output", invoke)
    result = await import_ai.invoke_import_output(api_key="provider-key", base_url="https://provider.invalid/v1",
        model="model", system_prompt="Format.", user_prompt="## Skills\nPython", output_type=resume_parser.CleanupOutput,
        timeout_seconds=1, trace_config=TraceConfig(True, "telemetry-key", "project"))
    assert result.cleaned_markdown == "## Skills\nPython"


def test_backend_client_routes_workspace_and_separates_cached_clients(monkeypatch):
    from app.core import tracing
    created = []
    def client(**kwargs):
        created.append(kwargs)
        return object()
    tracing._build_client.cache_clear()
    monkeypatch.setattr(tracing, "Client", client)
    try:
        first = tracing._build_client("test-key", "workspace-a")
        second = tracing._build_client("test-key", "workspace-b")
        assert first is tracing._build_client("test-key", "workspace-a")
        assert first is not second
        assert [item["workspace_id"] for item in created] == ["workspace-a", "workspace-b"]
    finally:
        tracing._build_client.cache_clear()


def test_backend_env_settings_read_langsmith_workspace(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGSMITH_WORKSPACE_ID", "workspace-test")
    assert Settings().langsmith_workspace_id == "workspace-test"


def test_backend_llm_trace_has_native_model_metadata(monkeypatch):
    from contextlib import nullcontext
    from app.core import tracing

    captured = []
    monkeypatch.setattr(tracing, "_build_client", lambda *_args: object())
    monkeypatch.setattr(tracing, "tracing_context", lambda **_kwargs: nullcontext())
    def trace(_name, **kwargs):
        captured.append(kwargs)
        return nullcontext()
    monkeypatch.setattr(tracing, "trace", trace)
    for run_type in ("llm", "chain"):
        with tracing.trace_llm_scope(enabled=True, api_key="test", project_name="project",
            name="applix.test", inputs={}, metadata={"model": "google/gemini-test"}, run_type=run_type):
            pass
    assert captured[0]["metadata"]["ls_model_name"] == "google/gemini-test"
    assert captured[0]["metadata"]["ls_provider"] == "openrouter"
    assert "ls_model_name" not in captured[1]["metadata"]


@pytest.mark.parametrize("counts,expected", [
    ({"input_tokens": 11, "output_tokens": 7}, {"input_tokens": 11, "output_tokens": 7, "total_tokens": 18}),
    ({"input_tokens": 0, "output_tokens": 0}, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}),
    ({"input_tokens": 11}, {"input_tokens": 11}),
    ({"input_tokens": -1, "output_tokens": True}, None),
    ({}, None),
])
def test_backend_native_usage_preserves_unknown_counts(counts, expected):
    from langsmith.run_trees import RunTree
    run = RunTree(name="test", run_type="llm", inputs={})
    original = {"outcome": "success", **counts}
    end_trace_safely(run, outputs=original)
    assert run.outputs.get("usage_metadata") == expected
    assert "usage_metadata" not in original


@pytest.mark.asyncio
@pytest.mark.parametrize("content_enabled", [False, True])
async def test_import_trace_includes_prompt_and_output_only_when_content_opted_in(monkeypatch, content_enabled):
    from contextlib import contextmanager
    from app.core.tracing import TraceConfig
    from app.services import import_ai

    captured = {}

    @contextmanager
    def fake_trace_scope(**kwargs):
        captured.update(kwargs)

        class FakeRun:
            def end(self, **end_kwargs):
                captured["end"] = end_kwargs

        yield FakeRun()

    async def invoke(**_kwargs):
        return resume_parser.CleanupOutput(cleaned_markdown="## Skills\nPython", needs_review=False, review_reason=None)

    monkeypatch.setattr(import_ai, "trace_llm_scope", fake_trace_scope)
    monkeypatch.setattr(import_ai, "_invoke_import_output", invoke)
    await import_ai.invoke_import_output(api_key="provider-key", base_url="https://provider.invalid/v1",
        model="google/gemini-3.8-flash", system_prompt="Format.", user_prompt="## Skills\nPython",
        output_type=resume_parser.CleanupOutput, timeout_seconds=1,
        trace_config=TraceConfig(True, "telemetry-key", "project", content_enabled=content_enabled))

    assert captured["metadata"]["output_mode"] == "native"
    assert captured["metadata"]["reasoning_effort"] == "medium"
    assert captured["metadata"]["content_traced"] is content_enabled
    if content_enabled:
        assert captured["inputs"]["messages"][1] == {"role": "user", "content": "## Skills\nPython"}
        assert captured["end"]["outputs"]["output"]["cleaned_markdown"] == "## Skills\nPython"
    else:
        assert "messages" not in captured["inputs"]
        assert "output" not in captured["end"]["outputs"]
        assert "Python" not in str(captured)


def test_trace_content_requires_tracing_enabled():
    from app.core.tracing import TraceConfig

    assert TraceConfig(False, "key", "project", content_enabled=True).include_content is False
    assert TraceConfig(True, "key", "project").include_content is False
    assert TraceConfig(True, "key", "project", content_enabled=True).include_content is True


def test_backend_env_settings_read_trace_content(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.delenv("LANGSMITH_TRACE_CONTENT", raising=False)
    assert Settings(_env_file=None).langsmith_trace_content is False
    monkeypatch.setenv("LANGSMITH_TRACE_CONTENT", "true")
    assert Settings(_env_file=None).langsmith_trace_content is True


@pytest.mark.asyncio
async def test_cleanup_root_keeps_placeholder_while_child_receives_content_opt_in(monkeypatch):
    captured = {}
    child_calls = []

    @contextmanager
    def fake_trace_scope(**kwargs):
        captured.update(kwargs)

        class FakeRun:
            def end(self, **end_kwargs):
                captured["end"] = end_kwargs

        yield FakeRun()

    async def fake_invoke(**kwargs):
        child_calls.append(kwargs)
        return resume_parser.CleanupOutput(cleaned_markdown="## Summary\nBuilt APIs.", needs_review=False, review_reason=None)

    monkeypatch.setattr(resume_parser, "trace_llm_scope", fake_trace_scope)
    monkeypatch.setattr(resume_parser, "invoke_import_output", fake_invoke)
    service = ResumeParserService(openrouter_api_key="openrouter-key", openrouter_model="model",
        langsmith_tracing=True, langsmith_project="project", langsmith_api_key="langsmith-key",
        langsmith_trace_content=True)

    await service.cleanup_with_llm("## Summary\nBuilt APIs.")

    assert captured["inputs"]["messages"][1]["content"] == "<resume body omitted from telemetry>"
    assert "Built APIs" not in str(captured)
    assert child_calls[0]["trace_config"].include_content is True


def test_resume_parser_factory_forwards_trace_content_setting(monkeypatch):
    from app.api import base_resumes
    from app.core import config

    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_PROJECT", "project")
    monkeypatch.setenv("LANGSMITH_API_KEY", "key")
    monkeypatch.setenv("LANGSMITH_TRACE_CONTENT", "true")
    config.get_settings.cache_clear()
    try:
        assert base_resumes.get_resume_parser().trace_config.include_content is True
    finally:
        config.get_settings.cache_clear()


def test_import_provider_settings_deny_retention_and_pin_gemini():
    from app.services.import_ai import _provider_settings_for

    assert _provider_settings_for("google/gemini-3.8-flash") == {"require_parameters": True, "data_collection": "deny",
        "sort": "latency", "only": ["google-ai-studio"]}
    assert "only" not in _provider_settings_for("openai/gpt-6-luna")
