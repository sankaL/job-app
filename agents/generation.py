"""Single-call resume generation service.

Generates structured JSON for the requested resume write action, then lets
the worker and validator split, validate, and assemble the Markdown locally.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from contextlib import suppress
from time import perf_counter
from typing import Any, Awaitable, Optional, TypeVar

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from experience_contract import (
    extract_professional_experience_anchors,
    normalize_professional_experience_section,
)
from privacy import sanitize_resume_markdown

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

OPERATION_PROMPTS: dict[str, str] = {
    "generation": "Generate a fresh tailored resume draft from the sanitized base resume.",
    "regeneration_full": "Regenerate the full tailored resume draft from the sanitized base resume.",
    "regeneration_section": "Regenerate only the requested section while keeping it compatible with the rest of the draft.",
}

SUPPORTED_SECTIONS = {"summary", "professional_experience", "education", "skills"}

SECTION_DISPLAY_NAMES: dict[str, str] = {
    "summary": "Summary",
    "professional_experience": "Professional Experience",
    "education": "Education",
    "skills": "Skills",
}

SUPPORTING_SNIPPET_LIMITS: dict[str, tuple[int, int]] = {
    "summary": (2, 4),
    "professional_experience": (2, 4),
    "education": (1, 2),
    "skills": (1, 3),
}

PROMPT_TRUNCATION_LIMITS = {
    "job_description": 16_000,
    "base_resume": 16_000,
    "current_section": 6_000,
    "other_sections": 8_000,
}

GENERATION_HEARTBEAT_INTERVAL_SECONDS = 15.0
GENERATION_HEARTBEAT_PERCENT = 45
GENERATION_HEARTBEAT_MESSAGE = "Waiting for structured resume output"
FULL_DRAFT_LLM_TIMEOUT_SECONDS = 240.0
SECTION_REGENERATION_LLM_TIMEOUT_SECONDS = 120.0
FULL_DRAFT_PRIMARY_ATTEMPT_TIMEOUT_SECONDS = 45.0
FULL_DRAFT_FALLBACK_ATTEMPT_TIMEOUT_SECONDS = 120.0
SECTION_REGENERATION_PRIMARY_ATTEMPT_TIMEOUT_SECONDS = 30.0
SECTION_REGENERATION_FALLBACK_ATTEMPT_TIMEOUT_SECONDS = 60.0
SUPPORTED_REASONING_EFFORTS = {"none", "low", "medium", "high", "xhigh"}
DEFAULT_GENERATION_REASONING_EFFORT = "none"

TARGET_LENGTH_GUIDANCE: dict[str, dict[str, Any]] = {
    "1_page": {
        "label": "1 page",
        "target_range": "450-700 words",
        "hard_cap": 850,
        "summary_range": "40-70 words",
        "experience_bullets": 4,
        "skills_categories": 2,
    },
    "2_page": {
        "label": "2 pages",
        "target_range": "900-1400 words",
        "hard_cap": 1600,
        "summary_range": "50-90 words",
        "experience_bullets": 5,
        "skills_categories": 3,
    },
    "3_page": {
        "label": "3 pages",
        "target_range": "1500-2100 words",
        "hard_cap": 2400,
        "summary_range": "60-110 words",
        "experience_bullets": 6,
        "skills_categories": 4,
    },
}

AGGRESSIVENESS_CONTRACTS: dict[str, dict[str, str]] = {
    "low": {
        "summary": "Light phrasing cleanup only. Preserve the source voice closely and tighten for clarity.",
        "professional_experience": (
            "Light rephrasing and bullet reordering only. Keep each role title exactly as it appears in the source. "
            "Do not add new metrics, scope, or technologies."
        ),
        "skills": "Do not change skills content or grouping. Preserve the source skills list as-is except for Markdown cleanup.",
        "education": "Do not change Education facts or wording beyond minimal formatting cleanup.",
    },
    "medium": {
        "summary": (
            "Substantial rewrite for role alignment using grounded source facts and job-description language. Reposition "
            "the candidate's profile toward the target role and you may introduce JD-aligned non-factual keywords when helpful."
        ),
        "professional_experience": (
            "Professional Experience is the primary tailoring surface in medium mode. Materially rewrite bullet framing in the first up to 2 source-ordered roles that have bullets. "
            "Keep the anchored role order fixed, but reprioritize by changing bullet emphasis within each role. "
            "Reframe bullet angles, consolidate, prune, and emphasize grounded bullets for the target role. "
            "Two source bullets covering related grounded work may be consolidated into one stronger bullet when that improves focus and specificity. "
            "Do not spend nearly all tailoring budget on Summary or Skills while leaving Professional Experience bullets source-identical. "
            "You may lightly reframe the role title only when it preserves the same core role family and seniority as the source title and target-role alignment clearly improves. "
            "Keep company and dates unchanged. You may add JD-relevant non-factual keyword phrasing, but do not add invented facts."
        ),
        "skills": (
            "Reorder, regroup, and prune to the most relevant skills for the target role. Lead with the most role-relevant "
            "skill cluster and you may add JD-aligned keyword skills for fit."
        ),
        "education": "Do not change Education facts or wording beyond minimal formatting cleanup.",
    },
    "high": {
        "summary": (
            "Fully rewrite the Summary for strongest role alignment. You may make bounded professional inferences from demonstrated patterns "
            "in the source, and you may introduce JD-driven non-factual keywords for fit, but never invent specific employers, dates, institutions, credentials, or metrics."
        ),
        "professional_experience": (
            "Professional Experience is the primary tailoring surface in high mode. Materially rewrite bullet framing in the first up to 2 source-ordered roles that have bullets. "
            "Keep the anchored role order fixed, but reprioritize by changing bullet emphasis within each role. "
            "Aggressively reframe, consolidate, condense, or expand grounded bullets for fit and impact. "
            "Do not spend nearly all tailoring budget on Summary or Skills while leaving Professional Experience bullets source-identical. "
            "You should actively retitle the role name for alignment or adjacent role framing when the target role clearly supports it and it still matches the demonstrated responsibilities, especially for the most recent role. "
            "Keep company and dates unchanged, keep duration consistent with the source, do not change seniority, "
            "and do not invent metrics, employers, institutions, or achievements. JD-driven keyword phrasing is allowed when it does not assert new facts."
        ),
        "skills": (
            "Aggressively prune, regroup, prioritize, and expand skills for target-role relevance. Lead with the most role-relevant "
            "skill cluster and include JD-driven keyword skills when helpful."
        ),
        "education": "Do not change Education facts or wording beyond minimal formatting cleanup.",
    },
}

SECTION_RULES: dict[str, str] = {
    "summary": (
        "Lead with the strongest grounded fit for the target role. Keep the section concise, concrete, specific, and natural. "
        "Do not use generic filler, first-person narration, or em dashes. If a sentence could describe almost anyone in the field, rewrite it until it feels candidate-specific."
    ),
    "professional_experience": (
        "Prioritize the most relevant experience first. Use concise accomplishment-oriented bullets grounded in the source. "
        "Preserve chronology facts and do not invent metrics or scope. "
        "Keep source role order fixed; when you reprioritize, do it by changing which facts you emphasize within the anchored role blocks. "
        "Bullet openings may vary; do not make every bullet follow the same verb-first pattern. "
        "When Professional Experience is enabled, medium and high must visibly tailor it instead of leaving the key bullets source-identical. "
        "Low aggressiveness must preserve role titles exactly. Medium may lightly reframe titles only when the core role family and seniority remain grounded in the source. "
        "High may retitle more freely only when the rewrite still matches demonstrated work and does not change employer, dates, duration, or seniority."
    ),
    "education": (
        "Keep Education concise and factual. Never add or infer schools, degrees, honors, dates, coursework, or credentials."
    ),
    "skills": (
        "Lead with the most role-relevant skill cluster and avoid keyword stuffing, duplicate categories, or generic buzzwords. "
        "Low keeps source skills only; medium and high may include JD-driven keyword skills for fit."
    ),
}

FACT_BOUNDARY_EXAMPLE = (
    "Worked example of acceptable vs unacceptable fact expansion:\n"
    "- Source fact: \"Built CI/CD pipelines for 12 AWS services and supported production deployments.\"\n"
    "- Acceptable grounded rewrite: \"Built and supported CI/CD pipelines across 12 AWS services for production deployments.\"\n"
    "- Unacceptable rewrite: \"Led DevOps strategy across 12 AWS microservices, reducing deployment failures by 40%.\"\n"
    "- Why: the unacceptable version adds leadership scope and a performance metric that are not present in the source."
)

INFERENCE_BOUNDARY_EXAMPLE = (
    "Worked example of bounded professional inference in high aggressiveness:\n"
    "- Source shows: managing a team of 15, coordinating delivery across clients, and owning test strategy.\n"
    "- Acceptable high-aggressiveness inference: retitle the role as \"QA Engineering Lead\" when the rest of the role content stays grounded in those demonstrated responsibilities.\n"
    "- Unacceptable inference: \"Reduced client attrition by 20%.\"\n"
    "- Why: the title reframe is an interpretation of demonstrated work, but the metric is an invented outcome with no source basis."
)

MEDIUM_TITLE_REFRAME_EXAMPLE = (
    "Worked example of bounded medium title reframing:\n"
    "- Source title: \"Backend Engineer\"\n"
    "- Acceptable medium rewrite: \"Platform Engineer\" when the source bullets already show platform APIs, deployment automation, and shared infrastructure work.\n"
    "- Unacceptable medium rewrite: \"Engineering Manager\" when the source does not show people management.\n"
    "- Why: medium may improve role alignment, but the rewrite still has to stay in the same grounded role family and preserve seniority."
)

EXPERIENCE_REWRITE_EXAMPLE = (
    "Worked example of material Professional Experience tailoring inside fixed role order:\n"
    "- Source bullets: \"Built backend APIs.\" and \"Maintained CI/CD pipelines.\"\n"
    "- Acceptable medium rewrite: \"Built backend APIs and maintained CI/CD pipelines for internal platform services.\"\n"
    "- Acceptable high rewrite: \"Built backend APIs and maintained CI/CD pipelines for internal platform services, emphasizing deployment reliability and shared tooling.\"\n"
    "- Unacceptable rewrite: leave the first two roles' bullets effectively unchanged while moving all tailoring effort into Summary or Skills.\n"
    "- Why: medium and high must visibly tailor Professional Experience when that section is enabled and the source supports stronger targeting."
)

VOICE_BOUNDARY_EXAMPLE = (
    "Worked example of avoiding filler:\n"
    "- Weak rewrite: \"Proven ability to leverage expertise in backend engineering to drive high-quality outcomes.\"\n"
    "- Better rewrite when the source supports it: \"Built backend APIs and maintained the deployment pipeline for internal platform services.\"\n"
    "- Why: the better version names real work instead of generic resume filler that could fit almost anyone."
)


class GeneratedSectionPayload(BaseModel):
    id: str
    heading: str
    markdown: str
    supporting_snippets: list[str] = Field(default_factory=list)

    @field_validator("id", "heading", "markdown")
    @classmethod
    def require_non_blank_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("supporting_snippets")
    @classmethod
    def normalize_snippets(cls, value: list[str]) -> list[str]:
        normalized = [snippet.strip() for snippet in value if snippet and snippet.strip()]
        if not normalized:
            raise ValueError("At least one supporting snippet is required.")
        return normalized

    @model_validator(mode="after")
    def cap_supporting_snippets(self) -> "GeneratedSectionPayload":
        max_snippets = SUPPORTING_SNIPPET_LIMITS.get(self.id, (1, 4))[1]
        self.supporting_snippets = self.supporting_snippets[:max_snippets]
        return self


class GeneratedResumePayload(BaseModel):
    sections: list[GeneratedSectionPayload]


class RegeneratedSectionPayload(BaseModel):
    section: GeneratedSectionPayload


T = TypeVar("T")


def _display_name(section_name: str) -> str:
    return SECTION_DISPLAY_NAMES.get(section_name, section_name.replace("_", " ").title())


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


def _normalize_snippet_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _normalize_section_entry(section_id: str, payload: Any) -> dict[str, Any]:
    if isinstance(payload, str):
        payload_dict: dict[str, Any] = {"markdown": payload}
    elif isinstance(payload, dict):
        payload_dict = payload
    else:
        raise TypeError(f"Unsupported section payload for {section_id}.")

    markdown = (
        payload_dict.get("markdown")
        or payload_dict.get("content")
        or payload_dict.get("content_md")
        or payload_dict.get("body")
        or payload_dict.get("text")
        or ""
    )
    heading = (
        payload_dict.get("heading")
        or payload_dict.get("title")
        or payload_dict.get("label")
        or _display_name(section_id)
    )
    normalized_id = (
        payload_dict.get("id")
        or payload_dict.get("section_id")
        or payload_dict.get("name")
        or section_id
    )
    supporting_snippets = _normalize_snippet_list(
        payload_dict.get("supporting_snippets")
        or payload_dict.get("supportingSnippets")
        or payload_dict.get("support")
        or payload_dict.get("snippets")
    )
    return {
        "id": str(normalized_id),
        "heading": str(heading),
        "markdown": str(markdown),
        "supporting_snippets": supporting_snippets,
    }


def _normalize_sections_list(entries: list[Any], expected_section_ids: list[str]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        if isinstance(entry, dict):
            derived_id = (
                entry.get("id")
                or entry.get("section_id")
                or entry.get("name")
                or (expected_section_ids[index] if index < len(expected_section_ids) else f"section_{index}")
            )
        else:
            derived_id = expected_section_ids[index] if index < len(expected_section_ids) else f"section_{index}"
        normalized.append(_normalize_section_entry(str(derived_id), entry))
    return normalized


def _looks_like_section_map(payload: dict[str, Any], expected_section_ids: list[str]) -> bool:
    if not payload:
        return False
    section_like_keys = [
        key
        for key, value in payload.items()
        if isinstance(value, (dict, str)) and (key in SUPPORTED_SECTIONS or key in expected_section_ids)
    ]
    return bool(section_like_keys) and len(section_like_keys) == len(payload)


def _normalize_resume_payload(payload: Any, expected_section_ids: list[str]) -> Any:
    if not isinstance(payload, dict):
        return payload

    if isinstance(payload.get("sections"), list):
        return {"sections": _normalize_sections_list(payload["sections"], expected_section_ids)}

    if isinstance(payload.get("sections"), dict):
        section_map: dict[str, Any] = payload["sections"]
    elif _looks_like_section_map(payload, expected_section_ids):
        section_map = payload
    else:
        return payload

    ordered_keys = [section_id for section_id in expected_section_ids if section_id in section_map]
    ordered_keys.extend([key for key in section_map if key not in ordered_keys])
    return {
        "sections": [_normalize_section_entry(section_id, section_map[section_id]) for section_id in ordered_keys]
    }


def _normalize_regenerated_section_payload(payload: Any, expected_section_id: Optional[str]) -> Any:
    if expected_section_id is None:
        return payload

    if isinstance(payload, str):
        return {"section": _normalize_section_entry(expected_section_id, payload)}

    if not isinstance(payload, dict):
        return payload

    if "section" in payload:
        return {"section": _normalize_section_entry(expected_section_id, payload["section"])}

    if expected_section_id in payload:
        return {"section": _normalize_section_entry(expected_section_id, payload[expected_section_id])}

    if any(
        key in payload
        for key in ("markdown", "content", "content_md", "body", "text", "heading", "title", "supporting_snippets")
    ):
        return {"section": _normalize_section_entry(expected_section_id, payload)}

    return payload


def _normalize_response_payload(
    *,
    payload: Any,
    response_model: type[BaseModel],
    expected_section_ids: Optional[list[str]],
) -> Any:
    if response_model is GeneratedResumePayload:
        return _normalize_resume_payload(payload, expected_section_ids or [])
    if response_model is RegeneratedSectionPayload:
        expected_section_id = expected_section_ids[0] if expected_section_ids else None
        return _normalize_regenerated_section_payload(payload, expected_section_id)
    return payload


def _supporting_snippet_instruction(section_id: str) -> str:
    min_count, max_count = SUPPORTING_SNIPPET_LIMITS.get(section_id, (1, 4))
    return f"{section_id}:{min_count}-{max_count}"


def _build_response_contract_instruction(*, enabled_sections: list[str], section_wrapper: bool = False) -> str:
    snippet_rules = ", ".join(_supporting_snippet_instruction(section_id) for section_id in enabled_sections)
    if section_wrapper:
        section_id = enabled_sections[0]
        return (
            "Response contract:\n"
            '- Return a single JSON object with exactly one top-level key: "section".\n'
            '- "section" must be an object with exactly these keys: id, heading, markdown, supporting_snippets.\n'
            f'- "section.id" must equal "{section_id}" and "section.heading" must equal "{_display_name(section_id)}".\n'
            f"- supporting_snippets counts by section: {snippet_rules}.\n"
        )
    return (
        "Response contract:\n"
        '- Return a single JSON object with exactly one top-level key: "sections".\n'
        '- "sections" must be an array ordered exactly as requested.\n'
        '- Each array item must be an object with exactly these keys: id, heading, markdown, supporting_snippets.\n'
        f"- supporting_snippets counts by section: {snippet_rules}.\n"
    )


def _build_role_block() -> str:
    return (
        "Role:\n"
        "- You are an expert ATS resume writer and editor.\n"
        "- Use modern resume-writing best practices: concise, concrete, accomplishment-oriented, keyword-aligned, easy to scan, and free of generic filler.\n"
        "- Do not use first-person narration or em dashes in model-authored resume content.\n"
    )


def _build_voice_rules_block() -> str:
    return (
        "Voice and specificity rules:\n"
        "- Avoid resume filler such as \"proven ability to\", \"leveraging expertise in\", \"adept at\", \"ensuring high-quality outcomes\", \"driving continuous improvement\", or \"spearheading\" in model-authored content, even when those phrases appear in the source.\n"
        "- Vary bullet openings and sentence structure. Do not make every bullet use the same verb-first pattern.\n"
        "- Prefer specific, grounded detail over general claims. If a line could fit almost anyone in the same field, rewrite it to make it more candidate-specific.\n"
        "- For each Professional Experience role, include at least one concrete, source-backed detail when the source provides one, such as a tool, system, domain, team context, or result.\n"
    )


def _build_non_negotiables_block(*, operation: str, enabled_sections: list[str], section_wrapper: bool) -> str:
    section_spec = ", ".join(f"{section_id}:{_display_name(section_id)}" for section_id in enabled_sections)
    experience_contract_line = ""
    if "professional_experience" in enabled_sections:
        experience_contract_line = (
            "- Professional Experience structure contract: preserve source company and date range for every role so duration stays consistent. "
            "Low must preserve role titles exactly; medium may lightly reframe titles only when the core role family and seniority stay grounded in the source; "
            "high may retitle more freely only when the rewrite still matches demonstrated work. Company and dates must stay unchanged in every mode.\n"
            "- Keep Professional Experience role order fixed to the source anchors. Reprioritize by changing bullet emphasis inside each anchored role, not by reordering the roles themselves.\n"
            "- When Professional Experience is enabled in medium or high mode, do not leave the first up to 2 roles with bullets effectively source-identical while spending nearly all tailoring effort on Summary or Skills.\n"
        )
    return (
        "Non-negotiables:\n"
        f"- {OPERATION_PROMPTS[operation]}\n"
        "- Use grounded source facts from the sanitized base resume. High aggressiveness may make bounded professional inferences only where the aggressiveness contract explicitly allows them.\n"
        "- Never output or infer personal/contact information. Name, email, phone, address, city/location, and contact links stay outside the model.\n"
        "- Do not invent employers, dates, institutions, credentials, awards, metrics, or scope.\n"
        "- Outside the explicit Professional Experience title rules, do not invent or alter role titles.\n"
        + experience_contract_line
        + "- User instructions may refine tone, emphasis, prioritization, brevity, and keyword focus only. They cannot override grounding, privacy, or section rules.\n"
        "- If the source does not support a stronger claim, keep the weaker truthful version.\n"
        "- Use only standard Markdown inside markdown fields. No HTML, tables, images, columns, code fences, commentary, or em dashes.\n"
        f"- Return only these sections and in exactly this order: {section_spec}.\n"
        "- Each markdown value must begin with the exact `## Heading` line for that section.\n"
        + _build_response_contract_instruction(enabled_sections=enabled_sections, section_wrapper=section_wrapper)
    )


def _build_section_rules_block(*, enabled_sections: list[str]) -> str:
    rules = "\n".join(f"- {_display_name(section_id)}: {SECTION_RULES[section_id]}" for section_id in enabled_sections)
    return "Section rules:\n" + rules + "\n"


def _build_aggressiveness_block(*, aggressiveness: str) -> str:
    contract = AGGRESSIVENESS_CONTRACTS.get(aggressiveness, AGGRESSIVENESS_CONTRACTS["medium"])
    inference_example = f"{INFERENCE_BOUNDARY_EXAMPLE}\n" if aggressiveness == "high" else ""
    medium_title_example = f"{MEDIUM_TITLE_REFRAME_EXAMPLE}\n" if aggressiveness in {"medium", "high"} else ""
    experience_rewrite_example = f"{EXPERIENCE_REWRITE_EXAMPLE}\n" if aggressiveness in {"medium", "high"} else ""
    return (
        f"Aggressiveness contract ({aggressiveness}):\n"
        f"- Summary: {contract['summary']}\n"
        f"- Professional Experience: {contract['professional_experience']}\n"
        f"- Skills: {contract['skills']}\n"
        f"- Education: {contract['education']}\n"
        f"{FACT_BOUNDARY_EXAMPLE}\n"
        f"{medium_title_example}"
        f"{experience_rewrite_example}"
        f"{inference_example}"
        f"{VOICE_BOUNDARY_EXAMPLE}\n"
    )


def _build_length_block(*, target_length: str, aggressiveness: str) -> str:
    config = TARGET_LENGTH_GUIDANCE.get(target_length, TARGET_LENGTH_GUIDANCE["1_page"])
    if aggressiveness == "low":
        return (
            f"Length contract ({config['label']}):\n"
            f"- Preferred total length when it fits the source naturally: {config['target_range']}.\n"
            f"- Hard cap: {config['hard_cap']} words, but do not prune grounded experience bullets or skills content just to force the draft under this cap in low-aggressiveness mode.\n"
            f"- Summary target when light cleanup makes it possible without substantive pruning: {config['summary_range']}.\n"
            "- Preserve existing Professional Experience bullet counts unless the source already fits the target without removing grounded content.\n"
            "- Preserve existing Skills content and grouping. Do not prune or regroup skills to satisfy length guidance in low-aggressiveness mode.\n"
            "- Education should remain concise.\n"
            "- If the source resume is already longer than the target, prefer minimal truthful cleanup over aggressive shortening.\n"
        )
    return (
        f"Length contract ({config['label']}):\n"
        f"- Target total length: {config['target_range']}.\n"
        f"- Hard cap: {config['hard_cap']} words.\n"
        f"- Summary target: {config['summary_range']}.\n"
        f"- Professional Experience: cap bullets at {config['experience_bullets']} per role. Reduce older or less relevant content first.\n"
        f"- Skills: cap category groups at {config['skills_categories']} and prioritize relevance over completeness.\n"
        "- Education should remain concise.\n"
        "- If the source resume does not contain enough grounded material to fill the target range, produce a shorter truthful output instead of padding or repeating content.\n"
    )


def _build_shared_system_prompt(
    *,
    operation: str,
    enabled_sections: list[str],
    aggressiveness: str,
    target_length: str,
    section_wrapper: bool = False,
) -> str:
    return (
        _build_role_block()
        + "\n"
        + _build_voice_rules_block()
        + "\n"
        + _build_non_negotiables_block(
            operation=operation,
            enabled_sections=enabled_sections,
            section_wrapper=section_wrapper,
        )
        + "\n"
        + _build_section_rules_block(enabled_sections=enabled_sections)
        + "\n"
        + _build_aggressiveness_block(aggressiveness=aggressiveness)
        + "\n"
        + _build_length_block(target_length=target_length, aggressiveness=aggressiveness)
    )


def _response_contract_payload(enabled_sections: list[str]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for section_id in enabled_sections:
        minimum, _maximum = SUPPORTING_SNIPPET_LIMITS.get(section_id, (1, 4))
        payload.append(
            {
                "id": section_id,
                "heading": _display_name(section_id),
                "markdown": f"## {_display_name(section_id)}\\n...",
                "supporting_snippets": ["exact snippet copied from sanitized base resume"] * minimum,
            }
        )
    return payload


def _build_generation_prompt(
    *,
    operation: str,
    base_resume_content: str,
    job_title: str,
    company_name: str,
    job_description: str,
    enabled_sections: list[str],
    aggressiveness: str,
    target_length: str,
    additional_instructions: Optional[str],
    professional_experience_anchors: list[dict[str, Any]],
) -> list[tuple[str, str]]:
    system_msg = _build_shared_system_prompt(
        operation=operation,
        enabled_sections=enabled_sections,
        aggressiveness=aggressiveness,
        target_length=target_length,
    )
    target_length_config = TARGET_LENGTH_GUIDANCE.get(target_length, TARGET_LENGTH_GUIDANCE["1_page"])
    human_payload = {
        "target_role": {
            "job_title": job_title,
            "company_name": company_name,
        },
        "enabled_sections": enabled_sections,
        "section_order": enabled_sections,
        "additional_instructions": additional_instructions,
        "style_contract": {
            "expert_resume_writer": True,
            "ats_safe": True,
            "no_em_dashes_in_model_authored_content": True,
            "no_first_person": True,
        },
        "aggressiveness_contract": AGGRESSIVENESS_CONTRACTS.get(aggressiveness, AGGRESSIVENESS_CONTRACTS["medium"]),
        "length_contract": {
            "target_length": target_length,
            "target_range": target_length_config["target_range"],
            "hard_cap_words": target_length_config["hard_cap"],
            "summary_range": target_length_config["summary_range"],
            "max_experience_bullets_per_role": target_length_config["experience_bullets"],
            "max_skills_categories": target_length_config["skills_categories"],
        },
        "section_rules": {section_id: SECTION_RULES[section_id] for section_id in enabled_sections},
        "professional_experience_structure_contract": {
            "anchors": professional_experience_anchors,
            "invariants": {
                "company_and_dates_must_match_source_for_every_role": True,
                "duration_must_stay_consistent_with_source": True,
                "low_titles_must_match_source_exactly": True,
                "medium_titles_may_reframe_but_must_preserve_core_role_family_and_seniority": True,
                "high_titles_may_retitle_when_supported_by_demonstrated_work_but_company_and_dates_must_stay_source_exact": True,
            },
        },
        "job_description": _normalize_prompt_text(job_description, PROMPT_TRUNCATION_LIMITS["job_description"]),
        "sanitized_base_resume_markdown": _normalize_prompt_text(
            base_resume_content, PROMPT_TRUNCATION_LIMITS["base_resume"]
        ),
        "response_contract": {
            "sections": _response_contract_payload(enabled_sections),
        },
    }
    return [("system", system_msg), ("human", json.dumps(human_payload, ensure_ascii=True))]


def _build_section_regeneration_prompt(
    *,
    section_name: str,
    instructions: str,
    current_section_content: str,
    other_sections_context: list[dict[str, str]],
    base_resume_content: str,
    job_title: str,
    company_name: str,
    job_description: str,
    aggressiveness: str,
    target_length: str,
    professional_experience_anchors: list[dict[str, Any]],
) -> list[tuple[str, str]]:
    system_msg = (
        _build_shared_system_prompt(
            operation="regeneration_section",
            enabled_sections=[section_name],
            aggressiveness=aggressiveness,
            target_length=target_length,
            section_wrapper=True,
        )
        + "\nSection-regeneration coherence rules:\n"
        + "- Keep terminology and tone compatible with the rest of the draft.\n"
        + "- Read other_sections_context and do not repeat a claim that already appears there verbatim or as the dominant selling point.\n"
        + "- Do not contradict the rest of the draft unless the source resume requires correction.\n"
    )
    target_length_config = TARGET_LENGTH_GUIDANCE.get(target_length, TARGET_LENGTH_GUIDANCE["1_page"])
    human_payload = {
        "target_role": {
            "job_title": job_title,
            "company_name": company_name,
        },
        "section_to_regenerate": {
            "id": section_name,
            "heading": _display_name(section_name),
        },
        "user_instructions": instructions,
        "style_contract": {
            "expert_resume_writer": True,
            "ats_safe": True,
            "no_em_dashes_in_model_authored_content": True,
        },
        "aggressiveness_contract": AGGRESSIVENESS_CONTRACTS.get(aggressiveness, AGGRESSIVENESS_CONTRACTS["medium"]),
        "length_contract": {
            "target_length": target_length,
            "target_range": target_length_config["target_range"],
            "hard_cap_words": target_length_config["hard_cap"],
        },
        "professional_experience_structure_contract": {
            "anchors": professional_experience_anchors,
            "invariants": {
                "company_and_dates_must_match_source_for_every_role": True,
                "duration_must_stay_consistent_with_source": True,
                "low_titles_must_match_source_exactly": True,
                "medium_titles_may_reframe_but_must_preserve_core_role_family_and_seniority": True,
                "high_titles_may_retitle_when_supported_by_demonstrated_work_but_company_and_dates_must_stay_source_exact": True,
            },
        },
        "job_description": _normalize_prompt_text(job_description, PROMPT_TRUNCATION_LIMITS["job_description"]),
        "sanitized_base_resume_markdown": _normalize_prompt_text(
            base_resume_content, PROMPT_TRUNCATION_LIMITS["base_resume"]
        ),
        "sanitized_current_section_markdown": _normalize_prompt_text(
            current_section_content, PROMPT_TRUNCATION_LIMITS["current_section"]
        ),
        "other_sections_context": other_sections_context,
        "response_contract": {
            "section": _response_contract_payload([section_name])[0],
        },
    }
    return [("system", system_msg), ("human", json.dumps(human_payload, ensure_ascii=True))]


def _normalize_reasoning_effort(reasoning_effort: Optional[str]) -> str:
    normalized = str(reasoning_effort or DEFAULT_GENERATION_REASONING_EFFORT).strip().lower()
    if normalized not in SUPPORTED_REASONING_EFFORTS:
        allowed = ", ".join(sorted(SUPPORTED_REASONING_EFFORTS))
        raise ValueError(f"Unsupported reasoning effort '{reasoning_effort}'. Expected one of: {allowed}.")
    return normalized


def _reasoning_config_for_operation(
    operation: str,
    reasoning_effort: Optional[str],
    *,
    is_fallback: bool = False,
) -> Optional[dict[str, Any]]:
    normalized_effort = _normalize_reasoning_effort(reasoning_effort)
    if operation in {"generation", "regeneration_full", "regeneration_section"}:
        payload: dict[str, Any] = {"effort": normalized_effort}
        if normalized_effort != "none":
            payload["exclude"] = True
        return payload
    return None


def _reasoning_effort(reasoning_config: Optional[dict[str, Any]]) -> Optional[str]:
    if not reasoning_config:
        return None
    effort = reasoning_config.get("effort")
    return str(effort) if effort else None


def _attempt_timeout_for_operation(operation: str, *, is_fallback: bool) -> float:
    if operation in {"generation", "regeneration_full"}:
        return FULL_DRAFT_FALLBACK_ATTEMPT_TIMEOUT_SECONDS if is_fallback else FULL_DRAFT_PRIMARY_ATTEMPT_TIMEOUT_SECONDS
    if operation == "regeneration_section":
        return (
            SECTION_REGENERATION_FALLBACK_ATTEMPT_TIMEOUT_SECONDS
            if is_fallback
            else SECTION_REGENERATION_PRIMARY_ATTEMPT_TIMEOUT_SECONDS
        )
    return FULL_DRAFT_FALLBACK_ATTEMPT_TIMEOUT_SECONDS if is_fallback else FULL_DRAFT_PRIMARY_ATTEMPT_TIMEOUT_SECONDS


def _temperature_for_aggressiveness(aggressiveness: str) -> float:
    normalized = str(aggressiveness or "medium").lower()
    if normalized == "low":
        return 0.2
    if normalized == "high":
        return 0.5
    return 0.35


def _build_llm(
    *,
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
    aggressiveness: str,
) -> ChatOpenAI:
    extra_body = {"reasoning": reasoning_config} if reasoning_config else None
    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        temperature=_temperature_for_aggressiveness(aggressiveness),
        request_timeout=timeout,
        max_retries=0,
        extra_body=extra_body,
    )


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


def _classify_attempt_outcome(
    error: Exception,
    *,
    transport_mode: str,
    reasoning_config: Optional[dict[str, Any]],
) -> tuple[str, Optional[str]]:
    if _is_timeout_error(error):
        return "timeout", "timeout"
    if reasoning_config is not None and _looks_like_reasoning_error(error):
        return "reasoning_rejected", "reasoning_unsupported"
    if transport_mode == "structured":
        if isinstance(error, ValidationError):
            return "invalid_structured_output", "structured_validation_failed"
        return "structured_failed", "structured_failed"
    if isinstance(error, (json.JSONDecodeError, ValidationError)):
        return "invalid_json", "invalid_json"
    return "provider_error", "attempt_failed"


def _build_attempt_record(
    *,
    model_name: str,
    reasoning_config: Optional[dict[str, Any]],
    transport_mode: str,
    outcome: str,
    elapsed_ms: int,
    retry_reason: Optional[str] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model_name,
        "reasoning_effort": _reasoning_effort(reasoning_config),
        "transport_mode": transport_mode,
        "outcome": outcome,
        "elapsed_ms": elapsed_ms,
    }
    if retry_reason:
        payload["retry_reason"] = retry_reason
    return payload


async def _invoke_structured_output(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
    aggressiveness: str,
) -> BaseModel:
    llm = _build_llm(
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
        reasoning_config=reasoning_config,
        aggressiveness=aggressiveness,
    ).with_structured_output(response_model)
    result = await asyncio.wait_for(llm.ainvoke(prompt), timeout=timeout)
    if isinstance(result, response_model):
        return result
    return response_model.model_validate(result)


async def _invoke_prompt_json(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    expected_section_ids: Optional[list[str]],
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
    aggressiveness: str,
) -> BaseModel:
    llm = _build_llm(
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
        reasoning_config=reasoning_config,
        aggressiveness=aggressiveness,
    )
    result = await asyncio.wait_for(llm.ainvoke(prompt), timeout=timeout)
    content = _extract_message_text(result.content)
    raw_payload = _extract_json_payload(content)
    normalized_payload = _normalize_response_payload(
        payload=raw_payload,
        response_model=response_model,
        expected_section_ids=expected_section_ids,
    )
    return response_model.model_validate(normalized_payload)


async def _attempt_transport(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    expected_section_ids: Optional[list[str]],
    operation: str,
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
    transport_mode: str,
    attempts: list[dict[str, Any]],
    aggressiveness: str,
) -> BaseModel:
    invoke = _invoke_structured_output if transport_mode == "structured" else _invoke_prompt_json
    invoke_kwargs = {
        "prompt": prompt,
        "response_model": response_model,
        "model_name": model_name,
        "api_key": api_key,
        "base_url": base_url,
        "timeout": timeout,
        "reasoning_config": reasoning_config,
        "aggressiveness": aggressiveness,
    }
    if transport_mode != "structured":
        invoke_kwargs["expected_section_ids"] = expected_section_ids

    started_at = perf_counter()
    logger.info(
        "generation_llm_attempt_start %s",
        {
            "operation": operation,
            "model": model_name,
            "reasoning_effort": _reasoning_effort(reasoning_config),
            "transport_mode": transport_mode,
            "timeout_seconds": timeout,
        },
    )
    try:
        payload = await invoke(**invoke_kwargs)
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        attempts.append(
            _build_attempt_record(
                model_name=model_name,
                reasoning_config=reasoning_config,
                transport_mode=transport_mode,
                outcome="success",
                elapsed_ms=elapsed_ms,
            )
        )
        logger.info(
            "generation_llm_attempt_success %s",
            {
                "model": model_name,
                "reasoning_effort": _reasoning_effort(reasoning_config),
                "transport_mode": transport_mode,
                "elapsed_ms": elapsed_ms,
            },
        )
        return payload
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        outcome, retry_reason = _classify_attempt_outcome(
            exc,
            transport_mode=transport_mode,
            reasoning_config=reasoning_config,
        )
        attempts.append(
            _build_attempt_record(
                model_name=model_name,
                reasoning_config=reasoning_config,
                transport_mode=transport_mode,
                outcome=outcome,
                elapsed_ms=elapsed_ms,
                retry_reason=retry_reason,
            )
        )
        logger.warning(
            "generation_llm_attempt_failure %s",
            {
                "model": model_name,
                "reasoning_effort": _reasoning_effort(reasoning_config),
                "transport_mode": transport_mode,
                "elapsed_ms": elapsed_ms,
                "outcome": outcome,
                "retry_reason": retry_reason,
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
        if reasoning_config is not None and _looks_like_reasoning_error(exc):
            started_at = perf_counter()
            try:
                invoke_kwargs["reasoning_config"] = None
                payload = await invoke(**invoke_kwargs)
                elapsed_ms = round((perf_counter() - started_at) * 1000)
                attempts.append(
                    _build_attempt_record(
                        model_name=model_name,
                        reasoning_config=None,
                        transport_mode=transport_mode,
                        outcome="success",
                        elapsed_ms=elapsed_ms,
                        retry_reason="reasoning_unsupported",
                    )
                )
                logger.info(
                    "generation_llm_attempt_success %s",
                    {
                        "model": model_name,
                        "reasoning_effort": None,
                        "transport_mode": transport_mode,
                        "elapsed_ms": elapsed_ms,
                        "retry_reason": "reasoning_unsupported",
                    },
                )
                return payload
            except Exception as inner_exc:
                elapsed_ms = round((perf_counter() - started_at) * 1000)
                inner_outcome, inner_retry_reason = _classify_attempt_outcome(
                    inner_exc,
                    transport_mode=transport_mode,
                    reasoning_config=None,
                )
                attempts.append(
                    _build_attempt_record(
                        model_name=model_name,
                        reasoning_config=None,
                        transport_mode=transport_mode,
                        outcome=inner_outcome,
                        elapsed_ms=elapsed_ms,
                        retry_reason=inner_retry_reason or "reasoning_unsupported",
                    )
                )
                logger.warning(
                    "generation_llm_attempt_failure %s",
                    {
                        "model": model_name,
                        "reasoning_effort": None,
                        "transport_mode": transport_mode,
                        "elapsed_ms": elapsed_ms,
                        "outcome": inner_outcome,
                        "retry_reason": inner_retry_reason or "reasoning_unsupported",
                        "error_type": type(inner_exc).__name__,
                        "message": str(inner_exc),
                    },
                )
                raise inner_exc
        raise


async def _call_json_with_fallback(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    expected_section_ids: Optional[list[str]],
    operation: str,
    model: str,
    fallback_model: str,
    api_key: str,
    base_url: str,
    timeout: float,
    aggressiveness: str,
    reasoning_effort: Optional[str],
) -> tuple[BaseModel, str, list[dict[str, Any]]]:
    last_error: Optional[Exception] = None
    attempts: list[dict[str, Any]] = []
    model_sequence = [(model, False, "structured")]
    if fallback_model and fallback_model != model:
        model_sequence.append((fallback_model, True, "json"))

    for model_name, is_fallback, transport_mode in model_sequence:
        reasoning_config = _reasoning_config_for_operation(
            operation,
            reasoning_effort,
            is_fallback=is_fallback,
        )
        attempt_timeout = min(timeout, _attempt_timeout_for_operation(operation, is_fallback=is_fallback))
        try:
            payload = await _attempt_transport(
                prompt=prompt,
                response_model=response_model,
                expected_section_ids=expected_section_ids,
                operation=operation,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
                timeout=attempt_timeout,
                reasoning_config=reasoning_config,
                transport_mode=transport_mode,
                attempts=attempts,
                aggressiveness=aggressiveness,
            )
            return payload, model_name, attempts
        except Exception as exc:
            last_error = exc

    if _is_timeout_error(last_error):
        raise asyncio.TimeoutError("LLM generation timed out on both primary and fallback models.") from last_error
    raise RuntimeError("LLM generation failed on both primary and fallback models.") from last_error


def _build_validation_repair_prompt(
    *,
    prompt: list[tuple[str, str]],
    validation_errors: list[Any],
    prior_response: dict[str, Any],
) -> list[tuple[str, str]]:
    normalized_errors = [
        str(error.get("detail") or error.get("type") or "").strip() if isinstance(error, dict) else str(error).strip()
        for error in validation_errors
    ]
    normalized_errors = [error for error in normalized_errors if error]
    requires_experience_tailoring_repair = any(
        (
            isinstance(error, dict)
            and str(error.get("type") or "").strip() == "insufficient_experience_tailoring"
        )
        or "insufficient professional experience tailoring" in str(error).lower()
        for error in validation_errors
    )
    repair_task = (
        "Repair the previous response so it satisfies the deterministic validation rules. "
        "Keep all content grounded in the sanitized base resume and preserve the original response contract."
    )
    if requires_experience_tailoring_repair:
        repair_task += (
            " The repair must materially rewrite Professional Experience in the first up to 2 source-ordered roles with bullets. "
            "Do not satisfy this repair by changing only Summary or Skills."
        )
    repair_payload = {
        "repair_task": repair_task,
        "validation_errors": normalized_errors[:12],
        "previous_response": prior_response,
    }
    return [*prompt, ("human", json.dumps(repair_payload, ensure_ascii=True))]


async def repair_generated_response(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    expected_section_ids: list[str],
    operation: str,
    validation_errors: list[Any],
    prior_response: dict[str, Any],
    model: str,
    fallback_model: str,
    model_used: str,
    prior_attempts: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    timeout: float,
    aggressiveness: str,
) -> tuple[Optional[BaseModel], str, list[dict[str, Any]], Optional[Exception]]:
    if timeout <= 0:
        return None, model_used, [], asyncio.TimeoutError("No remaining timeout budget for validation repair.")

    attempted_models = {str(attempt.get("model")) for attempt in prior_attempts if attempt.get("model")}
    repair_model = (
        fallback_model
        if fallback_model and fallback_model != model and fallback_model not in attempted_models
        else model_used
    )
    repair_prompt = _build_validation_repair_prompt(
        prompt=prompt,
        validation_errors=validation_errors,
        prior_response=prior_response,
    )
    repair_attempts: list[dict[str, Any]] = []
    repair_timeout = min(
        timeout,
        _attempt_timeout_for_operation(
            operation,
            is_fallback=repair_model == fallback_model and fallback_model != model,
        ),
    )
    try:
        payload = await _attempt_transport(
            prompt=repair_prompt,
            response_model=response_model,
            expected_section_ids=expected_section_ids,
            operation=operation,
            model_name=repair_model,
            api_key=api_key,
            base_url=base_url,
            timeout=repair_timeout,
            reasoning_config=None,
            transport_mode="repair_json",
            attempts=repair_attempts,
            aggressiveness=aggressiveness,
        )
        return payload, repair_model, repair_attempts, None
    except Exception as exc:
        return None, repair_model, repair_attempts, exc


async def _await_with_progress_heartbeat(
    *,
    operation: Awaitable[T],
    on_progress,
    percent: int,
    message: str,
    interval_seconds: Optional[float] = None,
) -> T:
    heartbeat_interval = interval_seconds or GENERATION_HEARTBEAT_INTERVAL_SECONDS
    task = asyncio.create_task(operation)
    try:
        while True:
            done, _pending = await asyncio.wait({task}, timeout=heartbeat_interval)
            if task in done:
                return await task
            await on_progress(percent, message)
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def _extract_section_markdown(draft: str, display_name: str) -> str:
    pattern = re.compile(
        rf"(^##\s*{re.escape(display_name)}\s*\n.*?)(?=^## |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(draft)
    if match:
        return match.group(1).strip()
    return ""


def _build_other_sections_context(*, draft: str, target_section_name: str) -> list[dict[str, str]]:
    context_entries: list[dict[str, str]] = []
    for section_name in SECTION_DISPLAY_NAMES:
        if section_name == target_section_name:
            continue
        section_markdown = _extract_section_markdown(draft, _display_name(section_name))
        if not section_markdown:
            continue
        sanitized_section = sanitize_resume_markdown(section_markdown).sanitized_markdown or section_markdown.strip()
        normalized_markdown = _normalize_prompt_text(sanitized_section, PROMPT_TRUNCATION_LIMITS["other_sections"])
        context_entries.append(
            {
                "id": section_name,
                "heading": _display_name(section_name),
                "markdown": normalized_markdown,
            }
        )
    return context_entries


def _section_label_list(section_ids: list[str]) -> str:
    return ", ".join(_display_name(section_id) for section_id in section_ids)


def _normalize_experience_section_if_present(
    *,
    sections: list[dict[str, Any]],
    professional_experience_anchors: list[dict[str, Any]],
    aggressiveness: str,
) -> None:
    if not professional_experience_anchors:
        return

    for section in sections:
        if section.get("name") != "professional_experience":
            continue
        normalized_content, _issues = normalize_professional_experience_section(
            section_markdown=str(section.get("content") or ""),
            anchors=professional_experience_anchors,
            aggressiveness=str(aggressiveness).lower(),
        )
        section["content"] = normalized_content
        return


async def generate_sections(
    *,
    base_resume_content: str,
    job_title: str,
    company_name: str,
    job_description: str,
    section_preferences: list[dict[str, Any]],
    generation_settings: dict[str, Any],
    model: str,
    fallback_model: str,
    api_key: str,
    base_url: str,
    on_progress,
    reasoning_effort: Optional[str] = DEFAULT_GENERATION_REASONING_EFFORT,
) -> dict[str, Any]:
    enabled = sorted(
        [section for section in section_preferences if section.get("enabled") and section.get("name") in SUPPORTED_SECTIONS],
        key=lambda section: section.get("order", 0),
    )
    if not enabled:
        raise ValueError("No enabled sections to generate.")

    section_ids = [section["name"] for section in enabled]
    operation = generation_settings.get("_operation", "generation")
    aggressiveness = generation_settings.get("aggressiveness", "medium")
    target_length = generation_settings.get("page_length", generation_settings.get("target_length", "1_page"))
    additional_instructions = generation_settings.get("additional_instructions")

    sanitized_base_resume = sanitize_resume_markdown(base_resume_content).sanitized_markdown
    if not sanitized_base_resume.strip():
        raise ValueError("Sanitized base resume content is empty.")

    professional_experience_anchors = extract_professional_experience_anchors(sanitized_base_resume)
    section_labels = _section_label_list(section_ids)

    await on_progress(20, f"Preparing generation plan for {section_labels}")
    await on_progress(35, f"Generating {section_labels} with structured output")
    prompt = _build_generation_prompt(
        operation=operation if operation in OPERATION_PROMPTS else "generation",
        base_resume_content=sanitized_base_resume,
        job_title=job_title,
        company_name=company_name,
        job_description=job_description,
        enabled_sections=section_ids,
        aggressiveness=aggressiveness,
        target_length=target_length,
        additional_instructions=additional_instructions,
        professional_experience_anchors=professional_experience_anchors,
    )
    payload, model_used, attempt_diagnostics = await _await_with_progress_heartbeat(
        operation=_call_json_with_fallback(
            prompt=prompt,
            response_model=GeneratedResumePayload,
            expected_section_ids=section_ids,
            operation=operation if operation in OPERATION_PROMPTS else "generation",
            model=model,
            fallback_model=fallback_model,
            api_key=api_key,
            base_url=base_url,
            timeout=FULL_DRAFT_LLM_TIMEOUT_SECONDS,
            aggressiveness=str(aggressiveness).lower(),
            reasoning_effort=reasoning_effort,
        ),
        on_progress=on_progress,
        percent=GENERATION_HEARTBEAT_PERCENT,
        message=f"Generating sections: {section_labels}",
    )

    await on_progress(
        60,
        (
            "Applying deterministic Professional Experience structure checks"
            if "professional_experience" in section_ids and professional_experience_anchors
            else "Normalizing structured section output"
        ),
    )
    await on_progress(70, "Parsing structured resume output")
    sections = [
        {
            "name": section.id,
            "heading": section.heading,
            "content": section.markdown.strip(),
            "supporting_snippets": section.supporting_snippets,
        }
        for section in payload.sections
    ]
    _normalize_experience_section_if_present(
        sections=sections,
        professional_experience_anchors=professional_experience_anchors,
        aggressiveness=str(aggressiveness).lower(),
    )
    return {
        "sections": sections,
        "model_used": model_used,
        "attempt_diagnostics": attempt_diagnostics,
        "prompt": prompt,
        "section_ids": section_ids,
        "operation": operation if operation in OPERATION_PROMPTS else "generation",
        "sanitized_base_resume": sanitized_base_resume,
        "professional_experience_anchors": professional_experience_anchors,
    }


def _replace_section_in_draft(
    draft: str,
    section_name: str,
    new_content: str,
    display_name: str,
) -> str:
    pattern = re.compile(
        rf"(^##\s*{re.escape(display_name)}\s*\n)(.*?)(?=^## |\Z)",
        re.MULTILINE | re.DOTALL,
    )

    match = pattern.search(draft)
    if match:
        replacement = new_content.rstrip("\n") + "\n\n"
        return draft[: match.start()] + replacement + draft[match.end() :]

    return draft.rstrip("\n") + "\n\n" + new_content.strip() + "\n"


async def regenerate_single_section(
    *,
    current_draft_content: str,
    section_name: str,
    instructions: str,
    base_resume_content: str,
    job_title: str,
    company_name: str,
    job_description: str,
    generation_settings: dict[str, Any],
    model: str,
    fallback_model: str,
    api_key: str,
    base_url: str,
    on_progress=None,
    reasoning_effort: Optional[str] = DEFAULT_GENERATION_REASONING_EFFORT,
) -> dict[str, Any]:
    aggressiveness = generation_settings.get("aggressiveness", "medium")
    target_length = generation_settings.get("page_length", generation_settings.get("target_length", "1_page"))

    sanitized_base_resume = sanitize_resume_markdown(base_resume_content).sanitized_markdown
    if not sanitized_base_resume.strip():
        raise ValueError("Sanitized base resume content is empty.")
    professional_experience_anchors = extract_professional_experience_anchors(sanitized_base_resume)

    display_name = _display_name(section_name)
    current_section = _extract_section_markdown(current_draft_content, display_name)
    sanitized_current_section = sanitize_resume_markdown(current_section).sanitized_markdown or current_section.strip()
    other_sections_context = _build_other_sections_context(draft=current_draft_content, target_section_name=section_name)

    prompt = _build_section_regeneration_prompt(
        section_name=section_name,
        instructions=instructions,
        current_section_content=sanitized_current_section,
        other_sections_context=other_sections_context,
        base_resume_content=sanitized_base_resume,
        job_title=job_title,
        company_name=company_name,
        job_description=job_description,
        aggressiveness=aggressiveness,
        target_length=target_length,
        professional_experience_anchors=professional_experience_anchors,
    )
    if on_progress is not None:
        await on_progress(35, f"Preparing {display_name} regeneration context")
        payload, model_used, attempt_diagnostics = await _await_with_progress_heartbeat(
            operation=_call_json_with_fallback(
                prompt=prompt,
                response_model=RegeneratedSectionPayload,
                expected_section_ids=[section_name],
                operation="regeneration_section",
                model=model,
                fallback_model=fallback_model,
                api_key=api_key,
                base_url=base_url,
                timeout=SECTION_REGENERATION_LLM_TIMEOUT_SECONDS,
                aggressiveness=str(aggressiveness).lower(),
                reasoning_effort=reasoning_effort,
            ),
            on_progress=on_progress,
            percent=GENERATION_HEARTBEAT_PERCENT,
            message=f"Generating {display_name} section",
        )
    else:
        payload, model_used, attempt_diagnostics = await _call_json_with_fallback(
            prompt=prompt,
            response_model=RegeneratedSectionPayload,
            expected_section_ids=[section_name],
            operation="regeneration_section",
            model=model,
            fallback_model=fallback_model,
            api_key=api_key,
            base_url=base_url,
            timeout=SECTION_REGENERATION_LLM_TIMEOUT_SECONDS,
            aggressiveness=str(aggressiveness).lower(),
            reasoning_effort=reasoning_effort,
        )

    section_content = payload.section.markdown.strip()
    if section_name == "professional_experience" and professional_experience_anchors:
        section_content, _issues = normalize_professional_experience_section(
            section_markdown=section_content,
            anchors=professional_experience_anchors,
            aggressiveness=str(aggressiveness).lower(),
        )
        if on_progress is not None:
            await on_progress(60, "Applying deterministic Professional Experience structure checks")
    elif on_progress is not None:
        await on_progress(60, "Normalizing regenerated section output")

    if on_progress is not None:
        await on_progress(70, "Parsing regenerated section output")

    return {
        "name": payload.section.id,
        "heading": payload.section.heading,
        "content": section_content,
        "supporting_snippets": payload.section.supporting_snippets,
        "model_used": model_used,
        "attempt_diagnostics": attempt_diagnostics,
        "prompt": prompt,
        "section_ids": [section_name],
        "operation": "regeneration_section",
        "sanitized_base_resume": sanitized_base_resume,
        "professional_experience_anchors": professional_experience_anchors,
    }
