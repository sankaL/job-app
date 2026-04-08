"""Single-call resume generation service.

Generates structured JSON for the requested resume write action, then lets
the worker and validator split, validate, and assemble the Markdown locally.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Optional

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator

from privacy import sanitize_resume_markdown

AGGRESSIVENESS_PROMPTS: dict[str, str] = {
    "low": (
        "Preserve the original voice closely. Make small keyword and phrasing adjustments only when the job description"
        " clearly justifies them."
    ),
    "medium": (
        "Reorder and rephrase grounded content to align with the role. Improve keyword alignment and emphasis without"
        " changing the underlying facts."
    ),
    "high": (
        "Rewrite assertively for fit and impact while staying strictly grounded in the source. Mirror important job"
        " language when the source supports it."
    ),
}

TARGET_LENGTH_GUIDANCE: dict[str, str] = {
    "1_page": "Keep the total draft concise and selective so it is likely to fit on one page.",
    "2_page": "Allow moderate detail and fuller bullet coverage so the total draft can span up to two pages.",
    "3_page": "Allow fuller detail and supporting bullets so the total draft can span up to three pages when needed.",
}

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

PROMPT_TRUNCATION_LIMITS = {
    "job_description": 16_000,
    "base_resume": 16_000,
    "current_section": 6_000,
}


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
        return normalized[:6]


class GeneratedResumePayload(BaseModel):
    sections: list[GeneratedSectionPayload]


class RegeneratedSectionPayload(BaseModel):
    section: GeneratedSectionPayload


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


def _build_shared_system_prompt(
    *,
    operation: str,
    enabled_sections: list[str],
    aggressiveness: str,
    target_length: str,
) -> str:
    section_spec = ", ".join(f"{section_id}:{_display_name(section_id)}" for section_id in enabled_sections)
    return (
        "You are an ATS-focused resume writing assistant.\n"
        f"Operation: {OPERATION_PROMPTS[operation]}\n"
        f"Length profile: {TARGET_LENGTH_GUIDANCE.get(target_length, TARGET_LENGTH_GUIDANCE['1_page'])}\n"
        f"Tailoring profile: {AGGRESSIVENESS_PROMPTS.get(aggressiveness, AGGRESSIVENESS_PROMPTS['medium'])}\n"
        "Hard requirements:\n"
        "- Use only facts grounded in the sanitized base resume source.\n"
        "- Never output or infer personal/contact information. Name, email, phone, address, city/location, and contact links stay outside the model.\n"
        "- Do not invent employers, titles, dates, institutions, credentials, awards, or technologies.\n"
        "- Use only standard Markdown. No HTML, tables, images, columns, code fences, or commentary.\n"
        f"- Return only these sections and in exactly this order: {section_spec}.\n"
        "- Return valid JSON only. No prose before or after the JSON object.\n"
        "- Every section must include 1 to 6 supporting_snippets copied verbatim from the sanitized base resume. Those snippets must justify the section's claims.\n"
        "- Each markdown value must begin with the exact `## Heading` line for that section.\n"
    )


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
) -> list[tuple[str, str]]:
    system_msg = _build_shared_system_prompt(
        operation=operation,
        enabled_sections=enabled_sections,
        aggressiveness=aggressiveness,
        target_length=target_length,
    )
    human_payload = {
        "target_role": {
            "job_title": job_title,
            "company_name": company_name,
        },
        "enabled_sections": enabled_sections,
        "section_order": enabled_sections,
        "additional_instructions": additional_instructions,
        "job_description": _normalize_prompt_text(job_description, PROMPT_TRUNCATION_LIMITS["job_description"]),
        "sanitized_base_resume_markdown": _normalize_prompt_text(
            base_resume_content, PROMPT_TRUNCATION_LIMITS["base_resume"]
        ),
        "response_contract": {
            "sections": [
                {
                    "id": section_id,
                    "heading": _display_name(section_id),
                    "markdown": f"## {_display_name(section_id)}\\n...",
                    "supporting_snippets": ["exact snippet copied from sanitized base resume"],
                }
                for section_id in enabled_sections
            ]
        },
    }
    return [("system", system_msg), ("human", json.dumps(human_payload, ensure_ascii=True))]


def _build_section_regeneration_prompt(
    *,
    section_name: str,
    instructions: str,
    current_section_content: str,
    base_resume_content: str,
    job_title: str,
    company_name: str,
    job_description: str,
    aggressiveness: str,
    target_length: str,
) -> list[tuple[str, str]]:
    system_msg = (
        _build_shared_system_prompt(
            operation="regeneration_section",
            enabled_sections=[section_name],
            aggressiveness=aggressiveness,
            target_length=target_length,
        )
        + "- Return an object shaped as {\"section\": {...}}.\n"
    )
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
        "job_description": _normalize_prompt_text(job_description, PROMPT_TRUNCATION_LIMITS["job_description"]),
        "sanitized_base_resume_markdown": _normalize_prompt_text(
            base_resume_content, PROMPT_TRUNCATION_LIMITS["base_resume"]
        ),
        "sanitized_current_section_markdown": _normalize_prompt_text(
            current_section_content, PROMPT_TRUNCATION_LIMITS["current_section"]
        ),
        "response_contract": {
            "section": {
                "id": section_name,
                "heading": _display_name(section_name),
                "markdown": f"## {_display_name(section_name)}\\n...",
                "supporting_snippets": ["exact snippet copied from sanitized base resume"],
            }
        },
    }
    return [("system", system_msg), ("human", json.dumps(human_payload, ensure_ascii=True))]


async def _call_json_with_fallback(
    *,
    prompt: list[tuple[str, str]],
    response_model: type[BaseModel],
    expected_section_ids: Optional[list[str]],
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

    for model_name in model_sequence:
        try:
            llm = ChatOpenAI(
                model=model_name,
                api_key=api_key,
                base_url=base_url,
                temperature=0.2,
                request_timeout=timeout,
                max_retries=0,
            )
            result = await asyncio.wait_for(llm.ainvoke(prompt), timeout=timeout)
            content = _extract_message_text(result.content)
        except Exception as exc:
            last_error = exc
            continue

        try:
            raw_payload = _extract_json_payload(content)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue

        try:
            normalized_payload = _normalize_response_payload(
                payload=raw_payload,
                response_model=response_model,
                expected_section_ids=expected_section_ids,
            )
            return response_model.model_validate(normalized_payload), model_name
        except ValidationError as exc:
            last_error = exc
            continue
        except TypeError as exc:
            last_error = exc
            continue

    raise RuntimeError("LLM generation failed on both primary and fallback models.") from last_error


def _extract_section_markdown(draft: str, display_name: str) -> str:
    pattern = re.compile(
        rf"(^##\s*{re.escape(display_name)}\s*\n.*?)(?=^## |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(draft)
    if match:
        return match.group(1).strip()
    return ""


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

    await on_progress(35, "Generating structured resume content")
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
    )
    payload, model_used = await _call_json_with_fallback(
        prompt=prompt,
        response_model=GeneratedResumePayload,
        expected_section_ids=section_ids,
        model=model,
        fallback_model=fallback_model,
        api_key=api_key,
        base_url=base_url,
        timeout=45.0,
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
    return {"sections": sections, "model_used": model_used, "sanitized_base_resume": sanitized_base_resume}


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
) -> dict[str, Any]:
    aggressiveness = generation_settings.get("aggressiveness", "medium")
    target_length = generation_settings.get("page_length", generation_settings.get("target_length", "1_page"))

    sanitized_base_resume = sanitize_resume_markdown(base_resume_content).sanitized_markdown
    if not sanitized_base_resume.strip():
        raise ValueError("Sanitized base resume content is empty.")

    display_name = _display_name(section_name)
    current_section = _extract_section_markdown(current_draft_content, display_name)
    sanitized_current_section = sanitize_resume_markdown(current_section).sanitized_markdown or current_section.strip()

    prompt = _build_section_regeneration_prompt(
        section_name=section_name,
        instructions=instructions,
        current_section_content=sanitized_current_section,
        base_resume_content=sanitized_base_resume,
        job_title=job_title,
        company_name=company_name,
        job_description=job_description,
        aggressiveness=aggressiveness,
        target_length=target_length,
    )
    payload, model_used = await _call_json_with_fallback(
        prompt=prompt,
        response_model=RegeneratedSectionPayload,
        expected_section_ids=[section_name],
        model=model,
        fallback_model=fallback_model,
        api_key=api_key,
        base_url=base_url,
        timeout=30.0,
    )

    return {
        "name": payload.section.id,
        "heading": payload.section.heading,
        "content": payload.section.markdown.strip(),
        "supporting_snippets": payload.section.supporting_snippets,
        "model_used": model_used,
        "sanitized_base_resume": sanitized_base_resume,
    }
