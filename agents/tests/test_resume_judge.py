from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import resume_judge
from resume_judge import JudgeDimensionResponse, JudgeModelResponse


def build_response(
    *,
    regeneration_priority_dimensions: list[str] | None = None,
    regeneration_instructions: str | None = "Tighten weak sections.",
    evaluator_notes: str = "Needs cleanup.",
) -> JudgeModelResponse:
    return JudgeModelResponse(
        score_summary="Useful overall summary.",
        dimension_scores={
            "role_alignment": JudgeDimensionResponse(score=8, notes="Aligned to the role."),
            "specificity_and_concreteness": JudgeDimensionResponse(score=6, notes="Some bullets are generic."),
            "voice_and_human_quality": JudgeDimensionResponse(score=4, notes="Reads templated."),
            "grounding_integrity": JudgeDimensionResponse(score=9, notes="Grounded in source."),
            "ats_safety_and_formatting": JudgeDimensionResponse(score=8, notes="ATS-safe."),
            "length_and_density": JudgeDimensionResponse(score=3, notes="Too padded."),
        },
        regeneration_instructions=regeneration_instructions,
        regeneration_priority_dimensions=regeneration_priority_dimensions or [],
        evaluator_notes=evaluator_notes,
    )


def test_extract_json_payload_enforces_strict_json():
    parsed = resume_judge._extract_json_payload('```json\n{"score_summary":"ok"}\n```')

    assert parsed["score_summary"] == "ok"
    with pytest.raises(json.JSONDecodeError):
        resume_judge._extract_json_payload("score_summary: ok")


def test_reasoning_config_explicitly_disables_reasoning_for_none():
    assert resume_judge._reasoning_config("none") == {"effort": "none"}
    assert resume_judge._reasoning_config("medium") == {"effort": "medium", "exclude": True}


def test_reasoning_error_detection_includes_mandatory_reasoning_rejections():
    assert resume_judge._looks_like_reasoning_error(
        RuntimeError("Reasoning is mandatory for this endpoint and cannot be disabled.")
    )


def test_finalize_response_computes_weighted_score_and_priority_order():
    result = resume_judge._finalize_response(
        response=build_response(
            regeneration_priority_dimensions=["length_and_density", "voice_and_human_quality"],
        ),
        evaluated_draft_updated_at="2026-04-07T12:10:00+00:00",
        scored_at="2026-04-07T12:12:00+00:00",
    )

    assert result["final_score"] == 67.5
    assert result["display_score"] == 68
    assert result["verdict"] == "warn"
    assert result["regeneration_priority_dimensions"] == [
        "length_and_density",
        "voice_and_human_quality",
    ]
    assert result["dimension_scores"]["role_alignment"]["weighted_contribution"] == 20.0


def test_finalize_response_clears_regeneration_fields_for_pass():
    passing = JudgeModelResponse(
        score_summary="Strong draft.",
        dimension_scores={
            "role_alignment": JudgeDimensionResponse(score=9, notes="Aligned."),
            "specificity_and_concreteness": JudgeDimensionResponse(score=8, notes="Specific."),
            "voice_and_human_quality": JudgeDimensionResponse(score=8, notes="Natural."),
            "grounding_integrity": JudgeDimensionResponse(score=9, notes="Grounded."),
            "ats_safety_and_formatting": JudgeDimensionResponse(score=9, notes="ATS-safe."),
            "length_and_density": JudgeDimensionResponse(score=8, notes="Right length."),
        },
        regeneration_instructions="This should be dropped.",
        regeneration_priority_dimensions=["voice_and_human_quality"],
        evaluator_notes="Looks strong.",
    )

    result = resume_judge._finalize_response(
        response=passing,
        evaluated_draft_updated_at="2026-04-07T12:10:00+00:00",
        scored_at="2026-04-07T12:12:00+00:00",
    )

    assert result["verdict"] == "pass"
    assert result["regeneration_instructions"] is None
    assert result["regeneration_priority_dimensions"] == []


@pytest.mark.asyncio
async def test_judge_resume_uses_fallback_model_after_primary_failure(monkeypatch):
    async def fake_attempt_model(**kwargs):
        attempts = kwargs["attempts"]
        model_name = kwargs["model_name"]
        if model_name == "primary-model":
            attempts.append({"model": "primary-model", "outcome": "provider_error"})
            raise RuntimeError("primary failed")
        attempts.append({"model": "fallback-model", "outcome": "success"})
        return build_response(
            regeneration_priority_dimensions=["voice_and_human_quality", "length_and_density"],
        )

    monkeypatch.setattr(resume_judge, "_attempt_model", fake_attempt_model)

    result = await resume_judge.judge_resume(
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs",
        base_resume_content="## Summary\nBuilt APIs.\n",
        generated_resume_content="# Resume\n\n## Summary\nBuilt APIs for customers.\n",
        aggressiveness="medium",
        target_length="1_page",
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        reasoning_effort="none",
        evaluated_draft_updated_at="2026-04-07T12:10:00+00:00",
        scored_at="2026-04-07T12:12:00+00:00",
    )

    assert result["model_used"] == "fallback-model"
    assert result["attempt_diagnostics"][0]["model"] == "primary-model"
    assert result["attempt_diagnostics"][1]["model"] == "fallback-model"
    assert result["resume_judge_result"]["status"] == "succeeded"
