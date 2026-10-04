from __future__ import annotations

import json

import httpx
import pytest

from app.services.resume_classifier import KINDS, classify_resume_sections


def _answer(choice="skills", confidence=0.9):
    return {"type": "choice", "choice": choice, "confidence": confidence,
        "probabilities": {kind: 1.0 if kind == choice else 0.0 for kind in KINDS}}


@pytest.mark.asyncio
async def test_jev_uses_decisions_endpoint_and_checks_complete_answer_ids(monkeypatch):
    captured = []

    def handler(request):
        captured.append(request)
        return httpx.Response(200, json={"answers": {"section-1": _answer()}})

    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    result = await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Python"}}, api_key="test-key", model="typesafe/jev-1.13")
    request = captured[0]
    payload = json.loads(request.content)
    assert str(request.url) == "https://openrouter.ai/api/alpha/decisions"
    assert payload["model"] == "typesafe/jev-1.13"
    assert payload["state"]["blocks"]["section-1"]["content"] == "Python"
    assert payload["questions"]["section-1"]["criteria"]["custom"]
    assert result["section-1"].choice == "skills"
    assert result["section-1"].confidence == 0.9


@pytest.mark.asyncio
async def test_jev_transport_retries_are_bounded(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503, json={"error": {"message": "unavailable"}})

    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Python"}}, api_key="test-key", model="typesafe/jev-1.13")
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("answers", [
    {},
    {"unknown-section": _answer()},
    {"section-1": {"type": "choice", "choice": "skills", "confidence": 1.0, "probabilities": {"skills": 1.0}}},
    {"section-1": {**_answer(), "confidence": 1.5}},
])
async def test_jev_invalid_decisions_fail_closed_without_output_retry(monkeypatch, answers):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"answers": answers})

    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ValueError):
        await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Python"}}, api_key="test-key", model="typesafe/jev-1.13")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_classification_traces_each_retry_with_safe_metrics(monkeypatch):
    from contextlib import contextmanager
    from app.core.tracing import TraceConfig

    traces = []
    requests = []
    class Run:
        def __init__(self, record):
            self.record = record
        def end(self, **kwargs):
            self.record.update(kwargs)
    @contextmanager
    def scope(**kwargs):
        record = dict(kwargs)
        traces.append(record)
        yield Run(record)
    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(503, json={"error": {"message": "Private echoed resume body"}})
        return httpx.Response(200, json={"answers": {"section-1": _answer()},
            "usage": {"prompt_tokens": 12, "completion_tokens": 4}})
    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr("app.services.resume_classifier.trace_llm_scope", scope)
    result = await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Private source text"}},
        api_key="provider-secret", model="typesafe/jev-1.13",
        trace_config=TraceConfig(enabled=True, api_key="telemetry-key", project_name="applix-dev"))
    assert result["section-1"].choice == "skills"
    assert len(traces) == 3
    assert traces[0]["run_type"] == "chain"
    assert [item["metadata"]["attempt"] for item in traces[1:]] == [1, 2]
    assert traces[1]["outputs"]["outcome"] == "failed"
    assert traces[2]["outputs"]["input_tokens"] == 12
    assert traces[2]["outputs"]["output_tokens"] == 4
    assert traces[2]["metadata"]["is_retry"] is True
    assert all(item["project_name"] == "applix-dev" for item in traces)
    assert "Private source" not in str(traces)
    assert "Private echoed" not in str(traces)
    assert "provider-secret" not in str(traces)


@pytest.mark.asyncio
@pytest.mark.parametrize("answers", [
    {},
    {"section-1": {**_answer(), "confidence": 1.5}},
])
async def test_rejected_classification_keeps_usage_without_answer_content(monkeypatch, answers):
    from contextlib import contextmanager
    from app.core.tracing import TraceConfig

    traces = []
    calls = []
    class Run:
        def __init__(self, record):
            self.record = record
        def end(self, **kwargs):
            self.record.update(kwargs)
    @contextmanager
    def scope(**kwargs):
        record = dict(kwargs)
        traces.append(record)
        yield Run(record)
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"answers": answers,
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
            "private_provider_field": "Private echoed resume body"})
    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr("app.services.resume_classifier.trace_llm_scope", scope)

    with pytest.raises(ValueError):
        await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Private source text"}},
            api_key="provider-secret", model="typesafe/jev-1.13",
            trace_config=TraceConfig(enabled=True, api_key="telemetry-key", project_name="applix-dev"))

    assert len(calls) == 1
    assert traces[-1]["outputs"]["outcome"] == "failed"
    assert traces[-1]["outputs"]["http_status"] == 200
    assert traces[-1]["outputs"]["input_tokens"] == 12
    assert traces[-1]["outputs"]["output_tokens"] == 4
    assert "Private source" not in str(traces)
    assert "Private echoed" not in str(traces)
    assert "provider-secret" not in str(traces)


@pytest.mark.asyncio
@pytest.mark.parametrize("content_enabled", [False, True])
async def test_classification_attempt_content_follows_trace_opt_in(monkeypatch, content_enabled):
    from contextlib import contextmanager
    from app.core.tracing import TraceConfig

    traces = []
    class Run:
        def __init__(self, record):
            self.record = record
        def end(self, **kwargs):
            self.record.update(kwargs)
    @contextmanager
    def scope(**kwargs):
        record = dict(kwargs)
        traces.append(record)
        yield Run(record)
    def handler(_request):
        return httpx.Response(200, json={"answers": {"section-1": _answer()}})
    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.services.resume_classifier.httpx.AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr("app.services.resume_classifier.trace_llm_scope", scope)
    await classify_resume_sections({"section-1": {"heading": "Skills", "content": "Opt-in source text"}},
        api_key="provider-secret", model="typesafe/jev-1.13",
        trace_config=TraceConfig(enabled=True, api_key="telemetry-key", project_name="applix-dev",
            content_enabled=content_enabled))
    root, attempt = traces
    assert attempt["metadata"]["content_traced"] is content_enabled
    assert "Opt-in source text" not in str(root)
    assert "provider-secret" not in str(traces)
    if content_enabled:
        assert attempt["inputs"]["blocks"]["section-1"]["content"] == "Opt-in source text"
        assert set(attempt["inputs"]["questions"]["section-1"]) >= {"type"}
        assert attempt["outputs"]["answers"]["section-1"]["choice"] == "skills"
    else:
        assert "Opt-in source text" not in str(attempt)
        assert "blocks" not in attempt["inputs"] and "answers" not in attempt["outputs"]
