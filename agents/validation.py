"""Deterministic resume validation service."""

from __future__ import annotations

import re
from typing import Any, Optional

from experience_contract import (
    extract_generated_experience_blocks,
    is_title_rewrite_allowed,
    normalize_text,
    validate_professional_experience_contract,
)
from privacy import EMAIL_RE, PHONE_RE, URL_RE, sanitize_resume_markdown

SECTION_DISPLAY_NAMES: dict[str, str] = {
    "summary": "Summary",
    "professional_experience": "Professional Experience",
    "education": "Education",
    "skills": "Skills",
}

DATE_TOKEN_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b"
    r"|\b\d{4}\s*[-/]\s*(?:\d{4}|present)\b"
    r"|\b(?:present|current)\b",
    re.I,
)
HTML_RE = re.compile(r"<[a-z][^>]*>", re.I)
TABLE_RE = re.compile(r"^\s*\|.*\|.*\|", re.MULTILINE)
IMAGE_RE = re.compile(r"!\[")
CODE_FENCE_RE = re.compile(r"```")
EM_DASH_RE = re.compile(r"—")

TARGET_WORD_LIMITS = {
    "1_page": 850,
    "2_page": 1600,
    "3_page": 2400,
}
SUPPORTING_SNIPPET_LIMITS = {
    "summary": (2, 4),
    "professional_experience": (2, 4),
    "education": (1, 2),
    "skills": (1, 3),
}
ROLE_AT_CLAIM_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9&/+.-]*(?:\s+[A-Z][A-Za-z0-9&/+.-]*){0,4})\s+at\s+([A-Z][A-Za-z0-9&/+.-]*(?:\s+[A-Z][A-Za-z0-9&/+.-]*){0,4})"
)
ROLE_COMPANY_LINE_RE = re.compile(r"^\s*\**([^|\n*]{3,80}?)\**\s*\|\s*([^|\n]{2,80}?)(?:\s*\||$)", re.MULTILINE)
CREDENTIAL_CLAIM_RE = re.compile(
    r"\b(?:Bachelor(?:\s+of\s+[A-Z][A-Za-z& ]+)?|Master(?:\s+of\s+[A-Z][A-Za-z& ]+)?|PhD|MBA|"
    r"Certified\s+[A-Z][A-Za-z0-9&+/\- ]+|[A-Z][A-Za-z0-9&+/\- ]+\s+Certification|"
    r"[A-Z][A-Za-z0-9&+/\- ]+\s+Clearance)\b"
)


def _display_name(section_name: str) -> str:
    return SECTION_DISPLAY_NAMES.get(section_name, section_name.replace("_", " ").title())


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def _normalize_search_text(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9+#/]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _snippet_terms(snippet: str) -> list[str]:
    if not any(delimiter in snippet for delimiter in (",", ";", "|")):
        return []
    parts = re.split(r"[,;|]+", snippet)
    terms = [_normalize_search_text(part) for part in parts]
    return [term for term in terms if len(term) >= 2]


def _is_grounded_snippet(snippet: str, *, normalized_source: str, searchable_source: str) -> bool:
    normalized_snippet = _normalize_whitespace(snippet)
    if not normalized_snippet:
        return False
    if normalized_snippet in normalized_source:
        return True

    searchable_snippet = _normalize_search_text(snippet)
    if searchable_snippet and searchable_snippet in searchable_source:
        return True

    terms = _snippet_terms(snippet)
    if terms and all(term in searchable_source for term in terms):
        return True

    return False


def _strip_markdown_formatting(value: str) -> str:
    value = re.sub(r"[*_`]", "", value)
    value = re.sub(r"^\s*[-+]\s*", "", value)
    return value.strip()


def _normalized_claim(value: str) -> str:
    return _normalize_search_text(_strip_markdown_formatting(value))


def _normalize_experience_line(value: str) -> str:
    return normalize_text(_strip_markdown_formatting(value))


def _bullet_lines_for_experience_block(block: dict[str, Any]) -> list[str]:
    lines = block.get("lines") or []
    bullets: list[str] = []
    for line in lines[1:]:
        stripped = str(line).strip()
        if stripped.startswith(("-", "*", "+")):
            bullets.append(stripped)
    return bullets


def _collect_claim_candidates(content: str) -> list[dict[str, str]]:
    plain_content = _strip_markdown_formatting(content)
    candidates: list[dict[str, str]] = []

    for title, company in ROLE_AT_CLAIM_RE.findall(plain_content):
        candidates.extend(
            [
                {"kind": "role_title", "value": title.strip()},
                {"kind": "company", "value": company.strip()},
            ]
        )

    for match in ROLE_COMPANY_LINE_RE.finditer(plain_content):
        title = match.group(1).strip()
        company = match.group(2).strip()
        if title and not title.startswith("## "):
            candidates.append({"kind": "role_title", "value": title})
        if company:
            candidates.append({"kind": "company", "value": company})

    for match in CREDENTIAL_CLAIM_RE.finditer(plain_content):
        candidates.append({"kind": "credential", "value": match.group(0).strip()})

    deduped: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        normalized = _normalized_claim(candidate["value"])
        if not normalized:
            continue
        dedupe_key = (candidate["kind"], normalized)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        deduped.append(candidate)
    return deduped


def _check_claim_grounding(
    *,
    generated_sections: list[dict[str, Any]],
    sanitized_base_resume_content: str,
    generation_settings: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    searchable_source = _normalize_search_text(sanitized_base_resume_content)
    errors: list[dict[str, Any]] = []
    aggressiveness = (
        str(generation_settings.get("aggressiveness", "medium")).lower()
        if generation_settings
        else "medium"
    )

    for section in generated_sections:
        content = str(section.get("content") or "")
        for claim in _collect_claim_candidates(content):
            normalized_claim = _normalized_claim(claim["value"])
            if (
                claim["kind"] == "role_title"
                and section["name"] == "professional_experience"
                and aggressiveness in {"medium", "high"}
            ):
                continue
            if normalized_claim and normalized_claim not in searchable_source:
                errors.append(
                    {
                        "type": "unsupported_claim",
                        "section": section["name"],
                        "detail": f"Claim is not grounded in the sanitized base resume: {claim['value']}",
                    }
                )

    return errors


def _check_required_sections(
    *,
    generated_sections: list[dict[str, Any]],
    section_preferences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enabled_names = [section["name"] for section in section_preferences if section.get("enabled")]
    generated_names = [section["name"] for section in generated_sections]
    errors: list[dict[str, Any]] = []

    for name in enabled_names:
        if name not in generated_names:
            errors.append(
                {
                    "type": "missing_section",
                    "section": name,
                    "detail": f"Section is enabled but not generated: {name}",
                }
            )

    return errors


def _check_unknown_or_duplicate_sections(
    *,
    generated_sections: list[dict[str, Any]],
    section_preferences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    allowed = {section["name"] for section in section_preferences if section.get("enabled")}
    seen: set[str] = set()
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        name = section["name"]
        if name not in allowed:
            errors.append(
                {
                    "type": "unexpected_section",
                    "section": name,
                    "detail": f"Section is not enabled for this run: {name}",
                }
            )
        if name in seen:
            errors.append(
                {
                    "type": "duplicate_section",
                    "section": name,
                    "detail": f"Section was returned more than once: {name}",
                }
            )
        seen.add(name)

    return errors


def _check_section_order(
    *,
    generated_sections: list[dict[str, Any]],
    section_preferences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enabled_ordered = sorted(
        [section for section in section_preferences if section.get("enabled")],
        key=lambda section: section.get("order", 0),
    )
    expected_order = [section["name"] for section in enabled_ordered]
    actual_order = [section["name"] for section in generated_sections]
    if expected_order == actual_order:
        return []
    return [
        {
            "type": "wrong_order",
            "section": None,
            "detail": f"Section order mismatch. Expected {expected_order}, got {actual_order}",
        }
    ]


def _check_heading_contract(
    *,
    generated_sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        expected_heading = _display_name(section["name"])
        content = str(section.get("content") or "").strip()
        first_line = content.splitlines()[0].strip() if content else ""
        expected_line = f"## {expected_heading}"
        if first_line != expected_line:
            errors.append(
                {
                    "type": "invalid_heading",
                    "section": section["name"],
                    "detail": f"Section must start with `{expected_line}`.",
                }
            )
        heading = str(section.get("heading") or "").strip()
        if heading != expected_heading:
            errors.append(
                {
                    "type": "invalid_heading_metadata",
                    "section": section["name"],
                    "detail": f"Section heading metadata must equal `{expected_heading}`.",
                }
            )

    return errors


def _check_supporting_snippets(
    *,
    generated_sections: list[dict[str, Any]],
    sanitized_base_resume_content: str,
) -> list[dict[str, Any]]:
    normalized_source = _normalize_whitespace(sanitized_base_resume_content)
    searchable_source = _normalize_search_text(sanitized_base_resume_content)
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        snippets = section.get("supporting_snippets") or []
        minimum, maximum = SUPPORTING_SNIPPET_LIMITS.get(section["name"], (1, 4))
        if not isinstance(snippets, list) or len(snippets) < minimum:
            errors.append(
                {
                    "type": "missing_support",
                    "section": section["name"],
                    "detail": f"Section requires at least {minimum} supporting snippets.",
                }
            )
            continue
        if len(snippets) > maximum:
            errors.append(
                {
                    "type": "excess_support",
                    "section": section["name"],
                    "detail": f"Section exceeds the maximum of {maximum} supporting snippets.",
                }
            )

        for snippet in snippets:
            snippet_text = str(snippet)
            if not _is_grounded_snippet(
                snippet_text,
                normalized_source=normalized_source,
                searchable_source=searchable_source,
            ):
                errors.append(
                    {
                        "type": "unsupported_snippet",
                        "section": section["name"],
                        "detail": f"Supporting snippet is not present in the sanitized base resume: {snippet_text}",
                    }
                )

    return errors


def _check_ats_safety(
    *,
    generated_sections: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    auto_corrections: list[dict[str, Any]] = []

    for section in generated_sections:
        content = str(section.get("content") or "")
        name = section["name"]

        if TABLE_RE.search(content):
            errors.append(
                {
                    "type": "ats_violation",
                    "section": name,
                    "detail": "Tables are not allowed.",
                }
            )
        if IMAGE_RE.search(content):
            errors.append(
                {
                    "type": "ats_violation",
                    "section": name,
                    "detail": "Images are not allowed.",
                }
            )
        if HTML_RE.search(content):
            errors.append(
                {
                    "type": "ats_violation",
                    "section": name,
                    "detail": "HTML is not allowed.",
                }
            )
        if CODE_FENCE_RE.search(content):
            errors.append(
                {
                    "type": "ats_violation",
                    "section": name,
                    "detail": "Code fences are not allowed.",
                }
            )
        if EM_DASH_RE.search(content):
            errors.append(
                {
                    "type": "style_violation",
                    "section": name,
                    "detail": "Em dashes are not allowed in generated resume content.",
                }
            )

        cleaned = re.sub(r"\n{3,}", "\n\n", content.strip())
        if cleaned != content.strip():
            auto_corrections.append(
                {
                    "type": "formatting",
                    "detail": f"Removed extra blank lines in {name}.",
                }
            )
            section["content"] = cleaned

    return errors, auto_corrections


def _check_contact_leakage(*, generated_sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        content = str(section.get("content") or "")
        if EMAIL_RE.search(content):
            errors.append(
                {
                    "type": "pii_leakage",
                    "section": section["name"],
                    "detail": "Email addresses are not allowed in generated sections.",
                }
            )
        if PHONE_RE.search(content):
            errors.append(
                {
                    "type": "pii_leakage",
                    "section": section["name"],
                    "detail": "Phone numbers are not allowed in generated sections.",
                }
            )
        if URL_RE.search(content):
            errors.append(
                {
                    "type": "pii_leakage",
                    "section": section["name"],
                    "detail": "Contact links are not allowed in generated sections.",
                }
            )
        if any(
            marker in content.lower()
            for marker in ("address:", "location:", "email:", "phone:", "linkedin.com/", "github.com/")
        ):
            errors.append(
                {
                    "type": "pii_leakage",
                    "section": section["name"],
                    "detail": "Contact header content leaked into generated sections.",
                }
            )

    return errors


def _check_date_grounding(
    *,
    generated_sections: list[dict[str, Any]],
    sanitized_base_resume_content: str,
) -> list[dict[str, Any]]:
    normalized_source = _normalize_whitespace(sanitized_base_resume_content)
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        content = str(section.get("content") or "")
        for token in {match.group(0).strip() for match in DATE_TOKEN_RE.finditer(content)}:
            if _normalize_whitespace(token) not in normalized_source:
                errors.append(
                    {
                        "type": "unsupported_date",
                        "section": section["name"],
                        "detail": f"Date-like token is not grounded in the sanitized base resume: {token}",
                    }
                )

    return errors


def _check_professional_experience_structure(
    *,
    generated_sections: list[dict[str, Any]],
    generation_settings: Optional[dict[str, Any]],
    professional_experience_anchors: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not professional_experience_anchors:
        return []

    aggressiveness = (
        str(generation_settings.get("aggressiveness", "medium")).lower()
        if generation_settings
        else "medium"
    )
    errors: list[dict[str, Any]] = []

    for section in generated_sections:
        if section.get("name") != "professional_experience":
            continue

        contract_errors = validate_professional_experience_contract(
            section_markdown=str(section.get("content") or ""),
            anchors=professional_experience_anchors,
            aggressiveness=aggressiveness,
        )
        for detail in contract_errors:
            errors.append(
                {
                    "type": "experience_structure_violation",
                    "section": "professional_experience",
                    "detail": detail,
                }
            )

    return errors


def _check_professional_experience_tailoring(
    *,
    generated_sections: list[dict[str, Any]],
    sanitized_base_resume_content: str,
    generation_settings: Optional[dict[str, Any]],
    professional_experience_anchors: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not professional_experience_anchors or not generation_settings:
        return []

    aggressiveness = str(generation_settings.get("aggressiveness", "medium")).lower()
    if aggressiveness not in {"medium", "high"}:
        return []

    generated_experience = next(
        (section for section in generated_sections if section.get("name") == "professional_experience"),
        None,
    )
    if generated_experience is None:
        return []

    source_blocks = extract_generated_experience_blocks(sanitized_base_resume_content)
    generated_blocks = extract_generated_experience_blocks(str(generated_experience.get("content") or ""))
    if not source_blocks or len(source_blocks) != len(generated_blocks):
        return []

    role_indexes_to_check: list[int] = []
    for index, source_block in enumerate(source_blocks):
        if _bullet_lines_for_experience_block(source_block):
            role_indexes_to_check.append(index)
        if len(role_indexes_to_check) >= 2:
            break
    if not role_indexes_to_check:
        return []

    total_source_bullets = 0
    rewritten_bullets = 0
    rewritten_titles = 0

    for index in role_indexes_to_check:
        source_block = source_blocks[index]
        generated_block = generated_blocks[index]
        anchor = professional_experience_anchors[index]

        source_bullet_lines = _bullet_lines_for_experience_block(source_block)
        total_source_bullets += len(source_bullet_lines)
        source_bullets = {
            normalized
            for normalized in (_normalize_experience_line(line) for line in source_bullet_lines)
            if normalized
        }
        generated_bullets = [
            normalized
            for normalized in (
                _normalize_experience_line(line) for line in _bullet_lines_for_experience_block(generated_block)
            )
            if normalized
        ]
        rewritten_bullets += sum(1 for bullet in generated_bullets if bullet not in source_bullets)

        source_title = str(anchor.get("source_title") or "").strip()
        generated_title = str(generated_block.get("header", {}).get("title") or "").strip()
        if source_title and generated_title and normalize_text(source_title) != normalize_text(generated_title):
            if is_title_rewrite_allowed(
                source_title=source_title,
                generated_title=generated_title,
                aggressiveness=aggressiveness,
            ):
                rewritten_titles += 1

    required_high_rewritten_bullets = min(2, total_source_bullets)
    passes = (
        rewritten_bullets >= 1 or rewritten_titles >= 1
        if aggressiveness == "medium"
        else rewritten_bullets >= required_high_rewritten_bullets
        or (rewritten_bullets >= 1 and rewritten_titles >= 1)
    )
    if passes:
        return []

    if aggressiveness == "medium":
        required_change = "at least 1 rewritten bullet or 1 grounded title rewrite"
    elif required_high_rewritten_bullets <= 1:
        required_change = "at least 1 rewritten bullet"
    else:
        required_change = "at least 2 rewritten bullets, or 1 rewritten bullet plus 1 grounded title rewrite"
    return [
        {
            "type": "insufficient_experience_tailoring",
            "section": "professional_experience",
            "detail": (
                "Insufficient Professional Experience tailoring for "
                f"{aggressiveness} aggressiveness: the first up to 2 source-ordered roles with bullets must show "
                f"{required_change}. Rewriting only Summary or Skills is not enough."
            ),
        }
    ]


def _check_length_guidance(
    *,
    generated_sections: list[dict[str, Any]],
    generation_settings: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not generation_settings:
        return []

    target_length = generation_settings.get("page_length", generation_settings.get("target_length", "1_page"))
    limit = TARGET_WORD_LIMITS.get(target_length)
    if limit is None:
        return []

    total_words = len(re.findall(r"\b\w+\b", "\n\n".join(str(section.get("content") or "") for section in generated_sections)))
    if total_words <= limit:
        return []

    return [
        {
            "type": "length_mismatch",
            "section": None,
            "detail": f"Generated content is too long for the requested target length ({total_words} words > {limit}).",
        }
    ]


async def validate_resume(
    *,
    generated_sections: list[dict[str, Any]],
    base_resume_content: str,
    section_preferences: list[dict[str, Any]],
    generation_settings: Optional[dict[str, Any]] = None,
    professional_experience_anchors: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    sanitized_base_resume = sanitize_resume_markdown(base_resume_content).sanitized_markdown

    all_errors: list[dict[str, Any]] = []
    all_corrections: list[dict[str, Any]] = []

    all_errors.extend(
        _check_unknown_or_duplicate_sections(
            generated_sections=generated_sections,
            section_preferences=section_preferences,
        )
    )
    all_errors.extend(
        _check_required_sections(
            generated_sections=generated_sections,
            section_preferences=section_preferences,
        )
    )
    all_errors.extend(
        _check_section_order(
            generated_sections=generated_sections,
            section_preferences=section_preferences,
        )
    )
    all_errors.extend(_check_heading_contract(generated_sections=generated_sections))
    all_errors.extend(
        _check_supporting_snippets(
            generated_sections=generated_sections,
            sanitized_base_resume_content=sanitized_base_resume,
        )
    )
    all_errors.extend(
        _check_claim_grounding(
            generated_sections=generated_sections,
            sanitized_base_resume_content=sanitized_base_resume,
            generation_settings=generation_settings,
        )
    )
    all_errors.extend(_check_contact_leakage(generated_sections=generated_sections))
    all_errors.extend(
        _check_date_grounding(
            generated_sections=generated_sections,
            sanitized_base_resume_content=sanitized_base_resume,
        )
    )
    all_errors.extend(
        _check_professional_experience_structure(
            generated_sections=generated_sections,
            generation_settings=generation_settings,
            professional_experience_anchors=professional_experience_anchors,
        )
    )
    all_errors.extend(
        _check_professional_experience_tailoring(
            generated_sections=generated_sections,
            sanitized_base_resume_content=sanitized_base_resume,
            generation_settings=generation_settings,
            professional_experience_anchors=professional_experience_anchors,
        )
    )

    ats_errors, ats_corrections = _check_ats_safety(generated_sections=generated_sections)
    all_errors.extend(ats_errors)
    all_corrections.extend(ats_corrections)
    all_errors.extend(
        _check_length_guidance(
            generated_sections=generated_sections,
            generation_settings=generation_settings,
        )
    )

    return {
        "valid": len(all_errors) == 0,
        "errors": all_errors,
        "auto_corrections": all_corrections,
    }
