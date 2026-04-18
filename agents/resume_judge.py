"""Resume Judge agent for scoring generated resumes against a job description."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from decimal import Decimal, ROUND_HALF_UP
from time import perf_counter
from typing import Any, Optional

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from privacy import CONTACT_URL_RE, EMAIL_RE, PHONE_RE, sanitize_resume_markdown

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SUPPORTED_REASONING_EFFORTS = {"none", "low", "medium", "high", "xhigh"}
DEFAULT_REASONING_EFFORT = "none"
DEFAULT_PASS_THRESHOLD = Decimal("80.0")

PROMPT_LIMITS = {
    "job_description": 16_000,
    "base_resume": 16_000,
    "generated_resume": 16_000,
}

TARGET_LENGTH_RANGES: dict[str, tuple[int, int]] = {
    "1_page": (450, 700),
    "2_page": (900, 1400),
    "3_page": (1500, 2100),
}

DIMENSION_SPECS: list[tuple[str, Decimal]] = [
    ("role_alignment", Decimal("0.25")),
    ("specificity_and_concreteness", Decimal("0.20")),
    ("voice_and_human_quality", Decimal("0.20")),
    ("grounding_integrity", Decimal("0.20")),
    ("ats_safety_and_formatting", Decimal("0.10")),
    ("length_and_density", Decimal("0.05")),
]
DIMENSION_WEIGHT_MAP = dict(DIMENSION_SPECS)

DIMENSION_NOTES = {
    "role_alignment": (
        "Score 0-10 for how clearly the draft positions the candidate for the target role and "
        "surfaces the job description's priorities."
    ),
    "specificity_and_concreteness": (
        "Score 0-10 for how specific, grounded, and concrete the claims are instead of generic."
    ),
    "voice_and_human_quality": (
        "Score 0-10 for natural, human, non-template writing quality and resistance to obvious AI phrasing patterns."
    ),
    "grounding_integrity": (
        "Score 0-10 for staying within the facts of the sanitized base resume for the selected aggressiveness."
    ),
    "ats_safety_and_formatting": (
        "Score 0-10 for ATS safety, clean Markdown structure, and absence of forbidden formatting/contact leakage in the sanitized draft."
    ),
    "length_and_density": (
        "Score 0-10 for fitting the target length and keeping content dense, purposeful, and not padded."
    ),
}

EM_DASH_RE = re.compile(r"—")
HTML_RE = re.compile(r"<[a-z][^>]*>", re.I)
TABLE_RE = re.compile(r"^\s*\|.*\|.*\|", re.MULTILINE)
CODE_FENCE_RE = re.compile(r"```")
FIRST_PERSON_RE = re.compile(r"\b(?:i|me|my|mine|myself)\b", re.I)
WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9+#/-]*")


class JudgeDimensionResponse(BaseModel):
    score: int
    notes: str

    @field_validator("score")
    @classmethod
    def validate_score(cls, value: int) -> int:
        if value < 0 or value > 10:
            raise ValueError("Dimension score must be between 0 and 10.")
        return value

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Dimension notes cannot be blank.")
        return stripped


class JudgeModelResponse(BaseModel):
    score_summary: str
    dimension_scores: dict[str, JudgeDimensionResponse]
    regeneration_instructions: Optional[str] = None
    regeneration_priority_dimensions: list[str] = Field(default_factory=list)
    evaluator_notes: str

    @field_validator("score_summary", "evaluator_notes")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("regeneration_instructions")
    @classmethod
    def normalize_regeneration_instructions(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("regeneration_priority_dimensions")
    @classmethod
    def normalize_priority_dimensions(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            key = str(item).strip()
            if key not in DIMENSION_WEIGHT_MAP or key in seen:
                continue
            seen.add(key)
            normalized.append(key)
        return normalized

    @model_validator(mode="after")
    def validate_dimension_scores(self) -> "JudgeModelResponse":
        missing = [name for name, _weight in DIMENSION_SPECS if name not in self.dimension_scores]
        if missing:
            raise ValueError(f"Missing dimension scores: {', '.join(missing)}")

        extra = [name for name in self.dimension_scores if name not in DIMENSION_WEIGHT_MAP]
        if extra:
            raise ValueError(f"Unexpected dimension scores: {', '.join(extra)}")

        return self


def _normalize_prompt_text(content: str, limit: int) -> str:
    collapsed = re.sub(r"\n{3,}", "\n\n", content.strip())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[:limit].rstrip() + "\n\n[Truncated for prompt budget]"


def _extract_message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return str(content)


def _extract_json_payload(text: str) -> Any:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return json.loads(stripped)


def _normalize_reasoning_effort(reasoning_effort: Optional[str]) -> str:
    normalized = str(reasoning_effort or DEFAULT_REASONING_EFFORT).strip().lower()
    if normalized not in SUPPORTED_REASONING_EFFORTS:
        allowed = ", ".join(sorted(SUPPORTED_REASONING_EFFORTS))
        raise ValueError(f"Unsupported reasoning effort '{reasoning_effort}'. Expected one of: {allowed}.")
    return normalized


def _reasoning_config(reasoning_effort: Optional[str]) -> Optional[dict[str, Any]]:
    normalized = _normalize_reasoning_effort(reasoning_effort)
    payload: dict[str, Any] = {"effort": normalized}
    if normalized != "none":
        payload["exclude"] = True
    return payload


def _reasoning_effort_value(reasoning_config: Optional[dict[str, Any]]) -> Optional[str]:
    if not reasoning_config:
        return None
    effort = reasoning_config.get("effort")
    return str(effort) if effort else None


def _looks_like_reasoning_error(error: Exception) -> bool:
    message = str(error).lower()
    return "reasoning" in message and any(
        token in message
        for token in ("unknown", "unsupported", "invalid", "field", "mandatory", "cannot be disabled")
    )


def _is_timeout_error(error: Optional[BaseException]) -> bool:
    seen: set[int] = set()
    current = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TimeoutError, asyncio.TimeoutError)):
            return True
        current = current.__cause__ or current.__context__
    return False


def _build_llm(
    *,
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
) -> ChatOpenAI:
    extra_body = {"reasoning": reasoning_config} if reasoning_config else None
    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
        request_timeout=timeout,
        max_retries=0,
        extra_body=extra_body,
    )


def _word_count(value: str) -> int:
    return len(WORD_RE.findall(value))


def _target_range(target_length: str) -> tuple[int, int]:
    return TARGET_LENGTH_RANGES.get(str(target_length or "1_page"), TARGET_LENGTH_RANGES["1_page"])


def _deterministic_observations(
    *,
    sanitized_generated_resume_markdown: str,
    target_length: str,
) -> dict[str, Any]:
    target_min, target_max = _target_range(target_length)
    word_count = _word_count(sanitized_generated_resume_markdown)
    contact_leaks: list[str] = []
    if EMAIL_RE.search(sanitized_generated_resume_markdown):
        contact_leaks.append("email")
    if PHONE_RE.search(sanitized_generated_resume_markdown):
        contact_leaks.append("phone")
    if CONTACT_URL_RE.search(sanitized_generated_resume_markdown):
        contact_leaks.append("contact_url")

    return {
        "word_count": word_count,
        "target_length": target_length,
        "target_range_words": {"min": target_min, "max": target_max},
        "outside_target_range": word_count < target_min or word_count > target_max,
        "em_dash_found": bool(EM_DASH_RE.search(sanitized_generated_resume_markdown)),
        "html_found": bool(HTML_RE.search(sanitized_generated_resume_markdown)),
        "table_found": bool(TABLE_RE.search(sanitized_generated_resume_markdown)),
        "code_fence_found": bool(CODE_FENCE_RE.search(sanitized_generated_resume_markdown)),
        "first_person_found": bool(FIRST_PERSON_RE.search(sanitized_generated_resume_markdown)),
        "contact_leak_found": bool(contact_leaks),
        "contact_leak_types": contact_leaks,
    }


def _build_system_prompt() -> str:
    dimension_lines = "\n".join(
        f"- {dimension}: weight {weight}."
        for dimension, weight in DIMENSION_SPECS
    )
    dimension_notes = "\n".join(
        f"- {dimension}: {description}"
        for dimension, description in DIMENSION_NOTES.items()
    )
    return (
        "You are Resume Judge, an expert resume quality evaluator.\n"
        "Your job is to score a generated resume draft against a job description and a sanitized base resume, "
        "then return a strict JSON verdict used by the application.\n\n"
        "You do not rewrite the resume. You only evaluate and score.\n\n"
        "Rules:\n"
        "- Evaluate only what is present in the provided inputs.\n"
        "- Never invent claims about the candidate, source resume, or generated draft.\n"
        "- Use deterministic_observations for ATS-safety and length-density facts instead of guessing them.\n"
        "- Score every dimension from 0 to 10.\n"
        "- Do not compute weighted arithmetic, final_score, display_score, verdict, or pass/fail thresholds. The application computes those locally.\n"
        "- Keep notes concise, evidence-based, and tied to concrete sections or patterns.\n"
        "- regeneration_instructions must be direct instructions for the resume generation agent. If the draft clearly passes, set regeneration_instructions to null and regeneration_priority_dimensions to [].\n"
        "- regeneration_priority_dimensions must contain at most two dimension ids from the allowed list.\n"
        "- Return exactly one JSON object and no surrounding prose.\n\n"
        "Dimension weights for local scoring:\n"
        f"{dimension_lines}\n\n"
        "Dimension guidance:\n"
        f"{dimension_notes}\n\n"
        "Expected JSON shape:\n"
        "{\n"
        '  "score_summary": "short overall assessment",\n'
        '  "dimension_scores": {\n'
        '    "role_alignment": {"score": 0, "notes": "..."},\n'
        '    "specificity_and_concreteness": {"score": 0, "notes": "..."},\n'
        '    "voice_and_human_quality": {"score": 0, "notes": "..."},\n'
        '    "grounding_integrity": {"score": 0, "notes": "..."},\n'
        '    "ats_safety_and_formatting": {"score": 0, "notes": "..."},\n'
        '    "length_and_density": {"score": 0, "notes": "..."}\n'
        "  },\n"
        '  "regeneration_instructions": "..." | null,\n'
        '  "regeneration_priority_dimensions": ["dimension_id"],\n'
        '  "evaluator_notes": "short overall evaluator note"\n'
        "}"
    )


def _build_prompt(
    *,
    job_title: str,
    company_name: Optional[str],
    job_description: str,
    sanitized_base_resume_markdown: str,
    sanitized_generated_resume_markdown: str,
    aggressiveness: str,
    target_length: str,
    deterministic_observations: dict[str, Any],
) -> list[tuple[str, str]]:
    human_payload = {
        "target_role": {
            "job_title": job_title,
            "company_name": company_name,
        },
        "aggressiveness": aggressiveness,
        "target_length": target_length,
        "job_description": _normalize_prompt_text(job_description, PROMPT_LIMITS["job_description"]),
        "sanitized_base_resume_markdown": _normalize_prompt_text(
            sanitized_base_resume_markdown,
            PROMPT_LIMITS["base_resume"],
        ),
        "sanitized_generated_resume_markdown": _normalize_prompt_text(
            sanitized_generated_resume_markdown,
            PROMPT_LIMITS["generated_resume"],
        ),
        "deterministic_observations": deterministic_observations,
    }
    return [("system", _build_system_prompt()), ("human", json.dumps(human_payload, ensure_ascii=True))]


def _attempt_record(
    *,
    model_name: str,
    reasoning_config: Optional[dict[str, Any]],
    outcome: str,
    elapsed_ms: int,
    retry_reason: Optional[str] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model_name,
        "reasoning_effort": _reasoning_effort_value(reasoning_config),
        "transport_mode": "json",
        "outcome": outcome,
        "elapsed_ms": elapsed_ms,
    }
    if retry_reason:
        payload["retry_reason"] = retry_reason
    return payload


async def _attempt_model(
    *,
    prompt: list[tuple[str, str]],
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
    attempts: list[dict[str, Any]],
) -> JudgeModelResponse:
    llm = _build_llm(
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
        reasoning_config=reasoning_config,
    )
    started_at = perf_counter()
    try:
        response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=timeout)
        payload = JudgeModelResponse.model_validate(
            _extract_json_payload(_extract_message_text(response.content))
        )
        attempts.append(
            _attempt_record(
                model_name=model_name,
                reasoning_config=reasoning_config,
                outcome="success",
                elapsed_ms=round((perf_counter() - started_at) * 1000),
            )
        )
        return payload
    except Exception as error:
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        outcome = "timeout" if _is_timeout_error(error) else "invalid_json"
        retry_reason = "reasoning_unsupported" if reasoning_config and _looks_like_reasoning_error(error) else None
        if not retry_reason and not isinstance(error, (json.JSONDecodeError, ValidationError)):
            outcome = "provider_error"
        attempts.append(
            _attempt_record(
                model_name=model_name,
                reasoning_config=reasoning_config,
                outcome=outcome,
                elapsed_ms=elapsed_ms,
                retry_reason=retry_reason,
            )
        )
        if reasoning_config and _looks_like_reasoning_error(error):
            retry_started_at = perf_counter()
            try:
                retry_response = await asyncio.wait_for(
                    _build_llm(
                        model_name=model_name,
                        api_key=api_key,
                        base_url=base_url,
                        timeout=timeout,
                        reasoning_config=None,
                    ).ainvoke(prompt),
                    timeout=timeout,
                )
                payload = JudgeModelResponse.model_validate(
                    _extract_json_payload(_extract_message_text(retry_response.content))
                )
                attempts.append(
                    _attempt_record(
                        model_name=model_name,
                        reasoning_config=None,
                        outcome="success",
                        elapsed_ms=round((perf_counter() - retry_started_at) * 1000),
                        retry_reason="reasoning_unsupported",
                    )
                )
                return payload
            except Exception as retry_error:
                retry_outcome = "timeout" if _is_timeout_error(retry_error) else "invalid_json"
                if not isinstance(retry_error, (json.JSONDecodeError, ValidationError)):
                    retry_outcome = "provider_error"
                attempts.append(
                    _attempt_record(
                        model_name=model_name,
                        reasoning_config=None,
                        outcome=retry_outcome,
                        elapsed_ms=round((perf_counter() - retry_started_at) * 1000),
                        retry_reason="reasoning_unsupported",
                    )
                )
                raise retry_error
        raise


def _round_decimal(value: Decimal, quant: str) -> Decimal:
    return value.quantize(Decimal(quant), rounding=ROUND_HALF_UP)


def _sorted_priority_dimensions(response: JudgeModelResponse) -> list[str]:
    ranked = sorted(
        (
            {
                "name": name,
                "score": response.dimension_scores[name].score,
                "weight": DIMENSION_WEIGHT_MAP[name],
            }
            for name, _weight in DIMENSION_SPECS
        ),
        key=lambda item: (item["score"], -float(item["weight"])),
    )
    allowed = set(response.regeneration_priority_dimensions)
    if allowed:
        filtered = [item["name"] for item in ranked if item["name"] in allowed]
        return filtered[:2]
    return [item["name"] for item in ranked[:2]]


def _finalize_response(
    *,
    response: JudgeModelResponse,
    evaluated_draft_updated_at: str,
    scored_at: str,
) -> dict[str, Any]:
    dimension_scores: dict[str, Any] = {}
    final_score = Decimal("0")
    for name, weight in DIMENSION_SPECS:
        dimension = response.dimension_scores[name]
        weighted = _round_decimal(Decimal(dimension.score) * weight * Decimal("10"), "0.1")
        final_score += weighted
        dimension_scores[name] = {
            "score": dimension.score,
            "weight": float(weight),
            "weighted_contribution": float(weighted),
            "notes": dimension.notes,
        }

    final_score = _round_decimal(final_score, "0.1")
    verdict = "pass" if final_score >= DEFAULT_PASS_THRESHOLD else "warn" if final_score >= Decimal("60.0") else "fail"
    priority_dimensions = [] if verdict == "pass" else _sorted_priority_dimensions(response)
    regeneration_instructions = None if verdict == "pass" else response.regeneration_instructions

    return {
        "status": "succeeded",
        "final_score": float(final_score),
        "display_score": int(_round_decimal(final_score, "1")),
        "verdict": verdict,
        "pass_threshold": float(DEFAULT_PASS_THRESHOLD),
        "score_summary": response.score_summary,
        "dimension_scores": dimension_scores,
        "regeneration_instructions": regeneration_instructions,
        "regeneration_priority_dimensions": priority_dimensions,
        "evaluator_notes": response.evaluator_notes,
        "evaluated_draft_updated_at": evaluated_draft_updated_at,
        "scored_at": scored_at,
    }


async def judge_resume(
    *,
    job_title: str,
    company_name: Optional[str],
    job_description: str,
    base_resume_content: str,
    generated_resume_content: str,
    aggressiveness: str,
    target_length: str,
    model: str,
    fallback_model: str,
    api_key: str,
    base_url: str,
    reasoning_effort: Optional[str],
    evaluated_draft_updated_at: str,
    scored_at: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    sanitized_base = sanitize_resume_markdown(base_resume_content).sanitized_markdown
    sanitized_generated = sanitize_resume_markdown(generated_resume_content).sanitized_markdown
    deterministic_observations = _deterministic_observations(
        sanitized_generated_resume_markdown=sanitized_generated,
        target_length=target_length,
    )
    prompt = _build_prompt(
        job_title=job_title,
        company_name=company_name,
        job_description=job_description,
        sanitized_base_resume_markdown=sanitized_base,
        sanitized_generated_resume_markdown=sanitized_generated,
        aggressiveness=aggressiveness,
        target_length=target_length,
        deterministic_observations=deterministic_observations,
    )

    attempts: list[dict[str, Any]] = []
    last_error: Optional[Exception] = None
    model_sequence = [model]
    if fallback_model and fallback_model != model:
        model_sequence.append(fallback_model)

    for index, model_name in enumerate(model_sequence):
        try:
            payload = await _attempt_model(
                prompt=prompt,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
                reasoning_config=_reasoning_config(reasoning_effort if index == 0 else reasoning_effort),
                attempts=attempts,
            )
            return {
                "resume_judge_result": _finalize_response(
                    response=payload,
                    evaluated_draft_updated_at=evaluated_draft_updated_at,
                    scored_at=scored_at,
                ),
                "model_used": model_name,
                "attempt_diagnostics": attempts,
                "prompt": prompt,
                "deterministic_observations": deterministic_observations,
            }
        except Exception as error:
            last_error = error

    if _is_timeout_error(last_error):
        raise asyncio.TimeoutError("Resume Judge timed out on both primary and fallback models.") from last_error
    raise RuntimeError("Resume Judge failed on both primary and fallback models.") from last_error
