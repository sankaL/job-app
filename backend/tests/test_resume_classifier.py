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
