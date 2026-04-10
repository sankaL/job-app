"""Single-call resume generation service.

Generates structured JSON for the requested resume write action, then lets
the worker and validator split, validate, and assemble the Markdown locally.
"""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import suppress
from typing import Any, Awaitable, Optional, TypeVar

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from experience_contract import (
    extract_professional_experience_anchors,
    normalize_professional_experience_section,
)
from privacy import sanitize_resume_markdown

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

GENERATION_HEARTBEAT_INTERVAL_SECONDS = 20.0
GENERATION_HEARTBEAT_PERCENT = 45
GENERATION_HEARTBEAT_MESSAGE = "Waiting for structured resume output"
FULL_DRAFT_LLM_TIMEOUT_SECONDS = 240.0
SECTION_REGENERATION_LLM_TIMEOUT_SECONDS = 120.0

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
        "summary": "Moderate rewrite for role alignment using only source-backed facts.",
        "professional_experience": (
            "Rephrase, reorder, prune, and emphasize grounded bullets for the target role. Keep each role title exactly as it appears in the source. "
            "Do not add new facts."
        ),
        "skills": "Reorder, regroup, and prune to the most relevant source-backed skills. Do not add new skills.",
        "education": "Do not change Education facts or wording beyond minimal formatting cleanup.",
    },
    "high": {
        "summary": "Fully rewrite the Summary for strongest role alignment using only source-backed facts.",
        "professional_experience": (
            "Aggressively reframe, reprioritize, condense, or expand grounded bullets for fit and impact. "
            "You may retitle the role name for alignment only when it remains a truthful reframing of the same source role. "
            "Keep employers and dates unchanged, and do not inflate scope, seniority, employers, or technologies."
        ),
        "skills": "Aggressively prune, regroup, and prioritize source-backed skills for relevance. Do not add new skills.",
        "education": "Do not change Education facts or wording beyond minimal formatting cleanup.",
    },
}

SECTION_RULES: dict[str, str] = {
    "summary": (
        "Lead with the strongest source-backed fit for the target role. Keep the section concise, concrete, and specific. "
        "Do not use generic filler, first-person narration, or em dashes."
    ),
    "professional_experience": (
        "Prioritize the most relevant experience first. Use concise accomplishment-oriented bullets grounded in the source. "
        "Preserve chronology facts and do not invent metrics, scope, or technologies. "
        "Low and medium aggressiveness must preserve role titles exactly; high aggressiveness may retitle role names only when the rewrite stays truthful to the same role and does not change employer, dates, or seniority."
    ),
    "education": (
        "Keep Education concise and factual. Never add or infer schools, degrees, honors, dates, coursework, or credentials."
    ),
    "skills": (
        "Use only source-backed skills. Prioritize role-relevant skills and avoid keyword stuffing, duplicate categories, or generic buzzwords."
    ),
}

BOUNDARY_EXAMPLE = (
    "Worked example of acceptable vs unacceptable rewriting:\n"
    "- Source fact: \"Built CI/CD pipelines for 12 AWS services and supported production deployments.\"\n"
    "- Acceptable high-aggressiveness rewrite: \"Built and supported CI/CD pipelines across 12 AWS services for production deployments.\"\n"
    "- Unacceptable rewrite: \"Led DevOps strategy across 12 AWS microservices, reducing deployment failures by 40%.\"\n"
    "- Why: the unacceptable version adds leadership scope and a performance metric that are not present in the source."
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


def _build_non_negotiables_block(*, operation: str, enabled_sections: list[str], section_wrapper: bool) -> str:
    section_spec = ", ".join(f"{section_id}:{_display_name(section_id)}" for section_id in enabled_sections)
    experience_contract_line = ""
    if "professional_experience" in enabled_sections:
        experience_contract_line = (
            "- Professional Experience structure contract: preserve source company and date range for every role. "
            "Low and medium must preserve role titles exactly; high may retitle only while keeping company and dates unchanged.\n"
        )
    return (
        "Non-negotiables:\n"
        f"- {OPERATION_PROMPTS[operation]}\n"
        "- Use only facts grounded in the sanitized base resume source.\n"
        "- Never output or infer personal/contact information. Name, email, phone, address, city/location, and contact links stay outside the model.\n"
        "- Do not invent employers, titles, dates, institutions, credentials, awards, metrics, scope, or technologies.\n"
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
    return (
        f"Aggressiveness contract ({aggressiveness}):\n"
        f"- Summary: {contract['summary']}\n"
        f"- Professional Experience: {contract['professional_experience']}\n"
        f"- Skills: {contract['skills']}\n"
        f"- Education: {contract['education']}\n"
        f"{BOUNDARY_EXAMPLE}\n"
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
                "low_and_medium_titles_must_match_source_exactly": True,
                "high_titles_may_retitle_but_company_and_dates_must_stay_source_exact": True,
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
        + "- Do not duplicate the strongest claims already emphasized elsewhere.\n"
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
                "low_and_medium_titles_must_match_source_exactly": True,
                "high_titles_may_retitle_but_company_and_dates_must_stay_source_exact": True,
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


def _reasoning_config_for_operation(operation: str) -> Optional[dict[str, Any]]:
    if operation in {"generation", "regeneration_full"}:
        return {"effort": "medium", "exclude": True}
    if operation == "regeneration_section":
        return {"effort": "high", "exclude": True}
    return None


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
        temperature=0.2,
        request_timeout=timeout,
        max_retries=0,
        extra_body=extra_body,
    )


def _looks_like_reasoning_error(error: Exception) -> bool:
    message = str(error).lower()
    return "reasoning" in message and any(token in message for token in ("unknown", "unsupported", "invalid", "field"))


def _is_timeout_error(error: Optional[BaseException]) -> bool:
    seen: set[int] = set()
    current = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TimeoutError, asyncio.TimeoutError)):
            return True
        current = current.__cause__ or current.__context__
    return False


async def _invoke_structured_output(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    model_name: str,
    api_key: str,
    base_url: str,
    timeout: float,
    reasoning_config: Optional[dict[str, Any]],
) -> BaseModel:
    llm = _build_llm(
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
        reasoning_config=reasoning_config,
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
) -> BaseModel:
    llm = _build_llm(
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
        reasoning_config=reasoning_config,
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
) -> tuple[BaseModel, str]:
    last_error: Optional[Exception] = None
    model_sequence = [model]
    if fallback_model and fallback_model != model:
        model_sequence.append(fallback_model)

    reasoning_config = _reasoning_config_for_operation(operation)

    for model_name in model_sequence:
        model_reasoning = reasoning_config

        try:
            payload = await _invoke_structured_output(
                prompt=prompt,
                response_model=response_model,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
                reasoning_config=model_reasoning,
            )
            return payload, model_name
        except Exception as exc:
            last_error = exc
            if model_reasoning is not None and _looks_like_reasoning_error(exc):
                model_reasoning = None
                try:
                    payload = await _invoke_structured_output(
                        prompt=prompt,
                        response_model=response_model,
                        model_name=model_name,
                        api_key=api_key,
                        base_url=base_url,
                        timeout=timeout,
                        reasoning_config=None,
                    )
                    return payload, model_name
                except Exception as inner_exc:
                    last_error = inner_exc
            if _is_timeout_error(last_error):
                # Move to fallback model immediately when a model times out.
                continue

        try:
            payload = await _invoke_prompt_json(
                prompt=prompt,
                response_model=response_model,
                expected_section_ids=expected_section_ids,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
                reasoning_config=model_reasoning,
            )
            return payload, model_name
        except Exception as exc:
            last_error = exc
            if model_reasoning is not None and _looks_like_reasoning_error(exc):
                try:
                    payload = await _invoke_prompt_json(
                        prompt=prompt,
                        response_model=response_model,
                        expected_section_ids=expected_section_ids,
                        model_name=model_name,
                        api_key=api_key,
                        base_url=base_url,
                        timeout=timeout,
                        reasoning_config=None,
                    )
                    return payload, model_name
                except Exception as inner_exc:
                    last_error = inner_exc

    if _is_timeout_error(last_error):
        raise asyncio.TimeoutError("LLM generation timed out on both primary and fallback models.") from last_error
    raise RuntimeError("LLM generation failed on both primary and fallback models.") from last_error


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
    payload, model_used = await _await_with_progress_heartbeat(
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
        payload, model_used = await _await_with_progress_heartbeat(
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
            ),
            on_progress=on_progress,
            percent=GENERATION_HEARTBEAT_PERCENT,
            message=f"Generating {display_name} section",
        )
    else:
        payload, model_used = await _call_json_with_fallback(
            prompt=prompt,
            response_model=RegeneratedSectionPayload,
            expected_section_ids=[section_name],
            operation="regeneration_section",
            model=model,
            fallback_model=fallback_model,
            api_key=api_key,
            base_url=base_url,
            timeout=SECTION_REGENERATION_LLM_TIMEOUT_SECONDS,
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
        "sanitized_base_resume": sanitized_base_resume,
        "professional_experience_anchors": professional_experience_anchors,
    }
