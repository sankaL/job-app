from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jev_audit  # noqa: E402
from resume_document import validate_resume_document  # noqa: E402


def answer(pass_option: str, p_pass: float, options: dict[str, str], failure: str) -> dict:
    probabilities = {key: 0.0 for key in options}
    probabilities[pass_option] = p_pass
    probabilities[failure] = round(1.0 - p_pass, 6)
    choice = max(probabilities, key=probabilities.get)
    return {"type": "choice", "choice": choice, "confidence": max(probabilities.values()), "probabilities": probabilities}


def claim(identifier: str, text: str = "Built APIs.") -> jev_audit.Claim:
    return jev_audit.Claim(identifier, "experience", text, "Built APIs.", "Engineer | Acme | 2020 - 2024")


@pytest.mark.parametrize("level,p_pass,expected", [
    ("medium", 0.95, ("accept", None)),
    ("medium", 0.05, ("reject", "unsupported_scope")),
    ("medium", 0.5, ("escalate", None)),
    ("high", 0.81, ("accept", None)),
    ("high", 0.1, ("reject", "implausible_claim")),
])
def test_route_accepts_rejects_and_escalates_by_pass_probability(level, p_pass, expected):
    options = jev_audit.options_for(level)
    failure = "unsupported_scope" if level == "medium" else "implausible_claim"
    parsed = jev_audit.JevAnswer.model_validate(answer(jev_audit.PASS_OPTION[level], p_pass, options, failure))
    assert jev_audit.route(parsed, level) == expected


def test_batches_cap_claims_per_call_and_questions_match_claims():
    claims = [claim(f"c{i}") for i in range(14)]
    batches = jev_audit.batches(claims, "medium", "typesafe/jev-1.13")
    assert [len(batch) for batch in batches] == [6, 6, 2]
    request = jev_audit.build_request(batches[0], "high", "typesafe/jev-1.13")
    assert set(request["questions"]) == set(request["state"]["claims"]) == {f"c{i}" for i in range(6)}
    assert set(request["questions"]["c0"]["criteria"]) == set(jev_audit.HIGH_OPTIONS)


@pytest.mark.asyncio
async def test_decide_retries_transient_failure_then_parses_answers(monkeypatch):
    monkeypatch.setattr(jev_audit, "trace_content_enabled", lambda: False)
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            return httpx.Response(503, json={"error": {"message": "busy"}})
        questions = calls[-1]["questions"]
        return httpx.Response(200, json={"answers": {key: answer("supported", 0.9, jev_audit.MEDIUM_OPTIONS, "unsupported_metric")
                                                     for key in questions}, "usage": {"prompt_tokens": 120, "cost": 0.00001}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await jev_audit.decide([claim("c0"), claim("c1")], "medium", api_key="test", client=client)
    assert len(calls) == 2
    assert {key: value.choice for key, value in result.items()} == {"c0": "supported", "c1": "supported"}


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    httpx.Response(200, json={"answers": {}}),
    httpx.Response(200, json={"answers": {"c0": {"type": "choice", "choice": "bogus", "confidence": 1.0, "probabilities": {"bogus": 1.0}}}}),
    httpx.Response(401, json={"error": {"message": "no"}}),
])
async def test_decide_fails_closed_on_incomplete_unexpected_or_rejected_answers(monkeypatch, response):
    monkeypatch.setattr(jev_audit, "trace_content_enabled", lambda: False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: response)) as client:
        with pytest.raises(jev_audit.JevUnavailable):
            await jev_audit.decide([claim("c0")], "medium", api_key="test", client=client)


def test_section_claims_split_bullets_and_sentences_with_role_evidence_and_flag_retitles():
    document = validate_resume_document({"schema_version": 1, "revision": 1, "sections": [
        {"id": "summary", "kind": "summary", "heading": "Summary", "review_state": "reviewed",
         "content_md": "Backend engineer. Builds APIs.", "source_ids": ["summary"]},
        {"id": "experience", "kind": "professional_experience", "heading": "Experience", "review_state": "reviewed",
         "entries": [{"id": "role", "fields": {"title": "Platform Engineer", "company": "Acme", "date_range": "2020 - 2024"},
                      "bullets": [{"id": "b1", "text": "Built APIs.", "source_ids": ["b1"]},
                                  {"id": "b2", "text": "Wrote tests.", "source_ids": ["b2"]}]}]},
    ]})
    texts = {"summary": "Backend engineer building APIs.", "b1": "Built APIs.", "b2": "Wrote tests.",
             "role": "Backend Engineer Acme 2020 - 2024 Built APIs. Wrote tests."}
    claims, needs_llm = jev_audit.section_claims(document.sections, texts, {"role": "Backend Engineer"})
    assert [c.text for c in claims] == ["Backend engineer.", "Builds APIs.", "Role title: Platform Engineer", "Built APIs.", "Wrote tests."]
    title = claims[2]
    assert title.kind == "title" and title.evidence.startswith("Source title: Backend Engineer")
    assert claims[3].evidence.startswith("Built APIs.") and "Same role:" in claims[3].evidence
    assert claims[3].role == "Platform Engineer | Acme | 2020 - 2024"
    assert needs_llm == set()
    request = jev_audit.build_request(claims, "high", "typesafe/jev-1.13")
    assert set(request["questions"][title.id]["criteria"]) == {"acceptable_reframe", "unsupported_role_reframe"}
    assert set(request["questions"][claims[3].id]["criteria"]) == set(jev_audit.HIGH_OPTIONS)


def test_title_claims_route_on_acceptable_reframe_probability():
    parsed = jev_audit.JevAnswer.model_validate({"type": "choice", "choice": "unsupported_role_reframe", "confidence": 0.9,
        "probabilities": {"acceptable_reframe": 0.05, "unsupported_role_reframe": 0.95}})
    assert jev_audit.route(parsed, "high", kind="title") == ("reject", "unsupported_role_reframe")


@pytest.mark.parametrize("p_accept,expected", [(0.3, "accept"), (0.2, "escalate"), (0.1, "reject")])
def test_title_claims_use_their_own_thresholds(p_accept, expected):
    parsed = jev_audit.JevAnswer.model_validate({"type": "choice", "choice": "acceptable_reframe" if p_accept >= 0.5 else "unsupported_role_reframe",
        "confidence": max(p_accept, 1 - p_accept), "probabilities": {"acceptable_reframe": p_accept, "unsupported_role_reframe": round(1 - p_accept, 6)}})
    assert jev_audit.route(parsed, "medium", kind="title")[0] == expected
