from __future__ import annotations

from dataclasses import dataclass


ReasoningEffort = str


@dataclass(frozen=True)
class OpenRouterGenerationModel:
    id: str
    label: str
    reasoning_efforts: tuple[ReasoningEffort, ...]


OPENROUTER_GENERATION_MODELS: tuple[OpenRouterGenerationModel, ...] = (
    OpenRouterGenerationModel(
        id="google/gemini-3-flash-preview",
        label="Gemini 3 Flash",
        reasoning_efforts=("none", "low", "medium", "high"),
    ),
    OpenRouterGenerationModel(
        id="openai/gpt-5.4-mini",
        label="GPT 5.4 Mini",
        reasoning_efforts=("none", "low", "medium", "high", "xhigh"),
    ),
    OpenRouterGenerationModel(
        id="google/gemini-3.5-flash",
        label="Gemini 3.5 Flash",
        reasoning_efforts=("none", "low", "medium", "high"),
    ),
)

OPENROUTER_GENERATION_MODEL_BY_ID = {
    model.id: model for model in OPENROUTER_GENERATION_MODELS
}


def normalize_reasoning_effort(value: object) -> str:
    normalized = str(value or "none").strip().lower()
    if normalized == "extra_high":
        return "xhigh"
    return normalized


def validate_generation_model_reasoning(*, model_id: str, reasoning_effort: str) -> None:
    model = OPENROUTER_GENERATION_MODEL_BY_ID.get(model_id)
    if model is None:
        allowed = ", ".join(model.id for model in OPENROUTER_GENERATION_MODELS)
        raise ValueError(f"Generation model must be one of: {allowed}.")
    if reasoning_effort not in model.reasoning_efforts:
        allowed_efforts = ", ".join(model.reasoning_efforts)
        raise ValueError(
            f"Reasoning effort '{reasoning_effort}' is not supported by {model.label}. "
            f"Use one of: {allowed_efforts}."
        )
