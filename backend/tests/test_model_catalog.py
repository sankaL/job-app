from __future__ import annotations

import pytest

from app.core.model_catalog import normalize_reasoning_effort, validate_generation_model_reasoning


def test_normalize_reasoning_effort_accepts_aliases_and_blank_values():
    assert normalize_reasoning_effort(None) == "none"
    assert normalize_reasoning_effort("  Extra_High ") == "xhigh"
    assert normalize_reasoning_effort(" HIGH ") == "high"


def test_validate_generation_model_reasoning_accepts_supported_combo():
    validate_generation_model_reasoning(
        model_id="openai/gpt-5.4-mini",
        reasoning_effort="xhigh",
    )


def test_validate_generation_model_reasoning_rejects_unknown_model():
    with pytest.raises(ValueError, match="Generation model must be one of"):
        validate_generation_model_reasoning(
            model_id="unknown/provider",
            reasoning_effort="none",
        )


def test_validate_generation_model_reasoning_rejects_unsupported_reasoning():
    with pytest.raises(ValueError, match="not supported by Gemini 3 Flash"):
        validate_generation_model_reasoning(
            model_id="google/gemini-3-flash-preview",
            reasoning_effort="xhigh",
        )
