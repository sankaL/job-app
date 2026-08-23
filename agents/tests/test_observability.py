from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generation
import resume_judge
import langsmith_tracing as tracing
import worker
from unslop_prompt import UNSLOP_INSTRUCTION, UNSLOP_PRECEDENCE


EXPECTED_UNSLOP_SHA256 = "0a04c5bc42b4882a71ef4e5f2a38e8dcf89faba73a07285f652c22b15f5228cb"


def test_generation_and_judge_prompts_include_exact_unslop_policy():
    generation_prompts = [
        generation._build_shared_system_prompt(
            operation=operation,
            enabled_sections=["summary"],
            aggressiveness="medium",
            target_length="1_page",
            section_wrapper=operation == "regeneration_section",
        )
        for operation in (
            "generation",
            "regeneration_full",
            "keyword_optimization",
            "regeneration_section",
        )
    ]
    judge_prompt = resume_judge._build_system_prompt()

    assert hashlib.sha256(UNSLOP_INSTRUCTION.encode()).hexdigest() == EXPECTED_UNSLOP_SHA256
    for prompt in (*generation_prompts, judge_prompt):
        assert UNSLOP_PRECEDENCE in prompt
        assert UNSLOP_INSTRUCTION in prompt

    repair_prompt = generation._build_validation_repair_prompt(
        prompt=[("system", generation_prompts[0]), ("human", "{}")],
        validation_errors=["Missing evidence"],
        prior_response={"sections": []},
    )
    assert UNSLOP_INSTRUCTION in repair_prompt[0][1]


@pytest.mark.asyncio
async def test_extraction_and_keyword_prompts_include_unslop_and_trace_metadata(monkeypatch):
    captured: list[tuple[list[tuple[str, str]], dict[str, Any]]] = []

    class FakeRunnable:
        def __init__(self, response_model) -> None:
            self.response_model = response_model

        async def ainvoke(self, prompt, config=None):
            captured.append((prompt, config or {}))
            if self.response_model is worker.ExtractedJobPosting:
                return self.response_model.model_validate(
                    {
                        "job_title": "Backend Engineer",
                        "job_description": "Build APIs.",
                        "company": "Acme",
                    }
                )
            return self.response_model.model_validate({"keywords": ["Build APIs"]})

    class FakeChatOpenAI:
        def __init__(self, **_kwargs) -> None:
            pass

        def with_structured_output(self, response_model):
            return FakeRunnable(response_model)

    monkeypatch.setattr(worker, "ChatOpenAI", FakeChatOpenAI)
    settings = worker.WorkerSettingsEnv(openrouter_api_key="test-key")

    await worker.OpenRouterExtractionAgent(settings)._extract_with_model("primary", worker.PageContext(
        source_url="https://example.com/job",
        final_url="https://example.com/job",
        page_title="Backend Engineer",
        meta={},
        json_ld=[],
        visible_text="Build APIs.",
        detected_origin=None,
        extracted_reference_id=None,
    ))
    await worker.OpenRouterKeywordExtractionAgent(settings)._extract_with_model("primary", "Build APIs")

    assert len(captured) == 2
    assert all(UNSLOP_PRECEDENCE in prompt[0][1] for prompt, _config in captured)
    assert all(UNSLOP_INSTRUCTION in prompt[0][1] for prompt, _config in captured)
    assert captured[0][1]["run_name"] == "applix.job_extraction.structured"
    assert captured[1][1]["run_name"] == "applix.keyword_extraction.structured"


def test_trace_sanitizer_removes_private_and_secret_values():
    sanitized = tracing.sanitize_trace_data(
        {
            "user_id": "user-123",
            "email": "alex@example.com",
            "phone": "+1 (416) 555-0100",
            "authorization": "Bearer secret-token",
            "text": (
                "See https://example.com/job?token=secret#private, "
                "https://linkedin.com/in/alex-example, and api_key=abc123."
            ),
        }
    )

    serialized = str(sanitized)
    assert "user-123" not in serialized
    assert "alex@example.com" not in serialized
    assert "416" not in serialized
    assert "secret-token" not in serialized
    assert "token=secret" not in serialized
    assert "abc123" not in serialized
    assert "alex-example" not in serialized
    assert "https://example.com/job" in serialized
    assert "<profile-url>" in serialized


@pytest.mark.asyncio
async def test_trace_workflow_survives_trace_completion_failure(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_PROJECT", "applix-test")
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_test")
    monkeypatch.setattr(tracing, "_build_client", lambda *_args: object())

    class FakeManager:
        def __init__(self, value=None) -> None:
            self.value = value

        def __enter__(self):
            return self.value

        def __exit__(self, *_args):
            return False

    class FailingRun:
        def end(self, **_kwargs) -> None:
            raise RuntimeError("telemetry unavailable")

    monkeypatch.setattr(tracing, "tracing_context", lambda **_kwargs: FakeManager())
    monkeypatch.setattr(tracing, "trace", lambda *_args, **_kwargs: FakeManager(FailingRun()))

    @tracing.trace_workflow("applix.test")
    async def operation(**_kwargs):
        return {"status": "ok"}

    assert await operation(application_id="app-1", job_id="job-1") == {"status": "ok"}


@pytest.mark.asyncio
async def test_trace_workflow_disabled_does_not_create_client(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setattr(tracing, "_build_client", lambda *_args: pytest.fail("client should not be created"))

    @tracing.trace_workflow("applix.test")
    async def operation(**_kwargs):
        return {"status": "ok"}

    assert await operation(user_id="private-user", application_id="app-1", job_id="job-1") == {"status": "ok"}


@pytest.mark.asyncio
async def test_trace_workflow_uses_project_safe_inputs_and_survives_setup_failure(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_PROJECT", "applix-test")
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_test")
    fake_client = object()
    monkeypatch.setattr(tracing, "_build_client", lambda *_args: fake_client)
    captured: dict[str, Any] = {}

    class FakeRun:
        def end(self, **kwargs) -> None:
            captured["outputs"] = kwargs["outputs"]

    class FakeManager:
        def __init__(self, value=None, fail=False) -> None:
            self.value = value
            self.fail = fail

        def __enter__(self):
            if self.fail:
                raise RuntimeError("telemetry unavailable")
            return self.value

        def __exit__(self, *_args):
            return False

    def fake_context(**kwargs):
        captured["project_name"] = kwargs["project_name"]
        return FakeManager()

    def fake_trace(_name, **kwargs):
        captured["inputs"] = kwargs["inputs"]
        captured["metadata"] = kwargs["metadata"]
        return FakeManager(FakeRun())

    monkeypatch.setattr(tracing, "tracing_context", fake_context)
    monkeypatch.setattr(tracing, "trace", fake_trace)

    @tracing.trace_workflow("applix.test")
    async def operation(**_kwargs):
        return {"status": "ok", "private": "not traced"}

    result = await operation(
        user_id="private-user",
        personal_info={"email": "alex@example.com"},
        application_id="app-1",
        job_id="job-1",
        base_resume_content="private resume",
    )

    assert result["private"] == "not traced"
    assert captured["project_name"] == "applix-test"
    assert captured["inputs"]["application_id"] == "app-1"
    assert "user_id" not in captured["inputs"]
    assert "personal_info" not in captured["inputs"]
    assert "private resume" not in str(captured)

    monkeypatch.setattr(tracing, "tracing_context", lambda **_kwargs: FakeManager(fail=True))
    assert await operation(application_id="app-2", job_id="job-2") == {
        "status": "ok",
        "private": "not traced",
    }


def test_worker_settings_require_langsmith_credentials_when_enabled():
    with pytest.raises(ValueError, match="LANGSMITH_PROJECT"):
        worker.WorkerSettingsEnv(langsmith_tracing=True, langsmith_api_key="key", langsmith_project="")
    with pytest.raises(ValueError, match="LANGSMITH_API_KEY"):
        worker.WorkerSettingsEnv(langsmith_tracing=True, langsmith_api_key="", langsmith_project="project")

    settings = worker.WorkerSettingsEnv(
        langsmith_tracing=True,
        langsmith_api_key="key",
        langsmith_project="project",
    )
    assert settings.langsmith_tracing is True


def test_local_environment_defaults_disable_and_forward_langsmith():
    repo_root = Path(__file__).resolve().parents[2]
    compose = (repo_root / "docker-compose.yml").read_text()
    root_env = (repo_root / ".env.compose.example").read_text()

    assert compose.count("LANGSMITH_TRACING: ${LANGSMITH_TRACING:-false}") == 2
    assert compose.count("LANGSMITH_PROJECT: ${LANGSMITH_PROJECT:-}") == 2
    assert compose.count("LANGSMITH_API_KEY: ${LANGSMITH_API_KEY:-}") == 2
    assert "GENERATION_AGENT_MODEL: ${GENERATION_AGENT_MODEL:-openai/gpt-5.6-luna}" in compose
    assert "GENERATION_AGENT_FALLBACK_MODEL: ${GENERATION_AGENT_FALLBACK_MODEL:-google/gemini-3.7-flash}" in compose
    assert "GENERATION_AGENT_REASONING_EFFORT: ${GENERATION_AGENT_REASONING_EFFORT:-auto}" in compose
    assert "LANGSMITH_TRACING=false" in root_env
