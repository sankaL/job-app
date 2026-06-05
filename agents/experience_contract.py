"""Deterministic resume structure helpers for experience and education."""

from __future__ import annotations

import re
from typing import Any, Optional

PROFESSIONAL_EXPERIENCE_HEADING = "## Professional Experience"
EDUCATION_HEADING = "## Education"

DATE_RANGE_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b"
    r"(?:\s*(?:-|–|—|to)\s*(?:"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}"
    r"|present|current))?"
    r"|\b\d{4}\s*[-/]\s*(?:\d{4}|present)\b"
    r"|\b(?:present|current)\b",
    re.I,
)
SINGLE_DATE_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b"
    r"|\b(?:19|20)\d{2}\b",
    re.I,
)
BULLET_RE = re.compile(r"^\s*[-*+]\s+")
TITLE_STOPWORDS = {"and", "of", "the", "to", "for", "in", "at", "with", "on", "a", "an"}
ROLE_FAMILY_TOKENS = {
    "accountant",
    "administrator",
    "advisor",
    "analyst",
    "architect",
    "consultant",
    "coordinator",
    "designer",
    "developer",
    "engineer",
    "executive",
    "manager",
    "operator",
    "partner",
    "producer",
    "recruiter",
    "researcher",
    "scientist",
    "specialist",
    "strategist",
    "supervisor",
    "technician",
    "writer",
}
SENIORITY_PATTERNS: tuple[tuple[str, int], ...] = (
    ("vice president", 7),
    ("vp", 7),
    ("chief", 8),
    ("director", 6),
    ("head", 6),
    ("principal", 5),
    ("staff", 4),
    ("lead", 4),
    ("manager", 4),
    ("supervisor", 4),
    ("senior", 3),
    ("sr", 3),
    ("associate", 2),
    ("junior", 1),
    ("jr", 1),
    ("intern", 0),
    ("trainee", 0),
    ("apprentice", 0),
)
INSTITUTION_RE = re.compile(
    r"\b(?:university|college|institute|school|academy|polytechnic|conservatory)\b",
    re.I,
)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _strip_inline_markdown(value: str) -> str:
    cleaned = re.sub(r"[`*_]", "", value)
    cleaned = re.sub(r"\[(.*?)\]\([^)]*\)", r"\1", cleaned)
    return cleaned.strip()


def _looks_like_date_range(value: str) -> bool:
    return DATE_RANGE_RE.search(_strip_inline_markdown(value)) is not None


def _looks_like_single_date(value: str) -> bool:
    return SINGLE_DATE_RE.search(_strip_inline_markdown(value)) is not None


def _looks_like_location(value: str) -> bool:
    normalized = _strip_inline_markdown(value)
    if not normalized or _looks_like_date_range(normalized) or _looks_like_single_date(normalized):
        return False
    if re.search(r"\b(remote|hybrid|onsite|on-site|usa|canada|uk|united states|united kingdom)\b", normalized, re.I):
        return True
    if "," in normalized or "/" in normalized:
        return True
    if re.search(r"\b[A-Z]{2}\b", normalized):
        return True
    words = normalized.split()
    return 1 <= len(words) <= 5


def _looks_like_institution(value: str) -> bool:
    return INSTITUTION_RE.search(_strip_inline_markdown(value)) is not None


def _split_pipe_line(line: str) -> list[str]:
    return [part.strip() for part in _strip_inline_markdown(line).split("|") if part.strip()]


def _title_tokens(value: str) -> set[str]:
    normalized = re.sub(r"[^a-z0-9+#/]+", " ", _strip_inline_markdown(value).lower())
    return {
        token
        for token in normalized.split()
        if token and token not in TITLE_STOPWORDS
    }


def _extract_seniority_rank(value: str) -> Optional[int]:
    normalized = normalize_text(_strip_inline_markdown(value))
    rank: Optional[int] = None
    for pattern, candidate_rank in SENIORITY_PATTERNS:
        if re.search(rf"\b{re.escape(pattern)}\b", normalized):
            rank = candidate_rank if rank is None else max(rank, candidate_rank)
    return rank


def _preserves_seniority(source_title: str, generated_title: str) -> bool:
    return _extract_seniority_rank(source_title) == _extract_seniority_rank(generated_title)


def _is_medium_title_grounded_in_source(source_title: str, generated_title: str) -> bool:
    if normalize_text(source_title) == normalize_text(generated_title):
        return True

    source_tokens = _title_tokens(source_title)
    generated_tokens = _title_tokens(generated_title)
    overlap = source_tokens & generated_tokens
    if not overlap:
        return False

    if overlap & ROLE_FAMILY_TOKENS:
        return True

    return len(overlap) >= 2


def is_title_rewrite_allowed(*, source_title: str, generated_title: str, aggressiveness: str) -> bool:
    normalized_aggressiveness = normalize_text(aggressiveness or "medium")
    if normalize_text(source_title) == normalize_text(generated_title):
        return True
    if normalized_aggressiveness == "low":
        return False
    if normalized_aggressiveness == "medium":
        return _is_medium_title_grounded_in_source(source_title, generated_title) and _preserves_seniority(
            source_title, generated_title
        )
    if normalized_aggressiveness == "high":
        return _preserves_seniority(source_title, generated_title)
    return False


def _extract_section(content: str, heading: str) -> Optional[str]:
    heading_text = re.escape(heading.replace("## ", ""))
    pattern = re.compile(
        rf"(^##\s*{heading_text}\s*$\n.*?)(?=^##\s|\Z)",
        re.I | re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(content)
    if not match:
        return None
    return match.group(1).strip()


def _section_blocks(section_markdown: str, heading: str) -> list[list[str]]:
    if not section_markdown.strip():
        return []

    lines = section_markdown.strip().splitlines()
    if lines and lines[0].strip().lower().startswith(heading.lower()):
        lines = lines[1:]

    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if not line.strip():
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line.rstrip())
    if current:
        blocks.append(current)
    return blocks


def _parse_entry_block(block: list[str], *, section_kind: str) -> dict[str, Any]:
    header_lines: list[str] = []
    body_lines: list[str] = []
    bullet_started = False
    for raw_line in block:
        line = raw_line.strip()
        if BULLET_RE.match(line):
            bullet_started = True
            body_lines.append(raw_line.rstrip())
            continue
        if bullet_started:
            body_lines.append(raw_line.rstrip())
            continue
        header_lines.append(raw_line.rstrip())

    allow_single_date = section_kind == "education"

    if len(header_lines) == 1:
        parts = _split_pipe_line(header_lines[0])
        if len(parts) != 3:
            raise ValueError("Entry must have two rows or one supported three-part row.")
        left_a, left_b, right = parts
        if not (_looks_like_date_range(right) or (allow_single_date and _looks_like_single_date(right))):
            raise ValueError("Entry date field is malformed.")
        if section_kind == "education":
            school = left_a if _looks_like_institution(left_a) else left_b
            degree = left_b if school == left_a else left_a
            return {
                "row1_left": school,
                "row1_right": None,
                "row2_left": degree,
                "row2_right": right,
                "body_lines": body_lines,
            }
        return {
            "row1_left": left_b,
            "row1_right": None,
            "row2_left": left_a,
            "row2_right": right,
            "body_lines": body_lines,
        }

    if len(header_lines) != 2:
        raise ValueError("Entry must have exactly two header rows.")

    first_parts = _split_pipe_line(header_lines[0])
    second_parts = _split_pipe_line(header_lines[1])
    if len(first_parts) > 2 or len(second_parts) > 2:
        raise ValueError("Structured row contains too many columns.")

    first_left = first_parts[0]
    first_right = first_parts[1] if len(first_parts) == 2 else None
    second_left = second_parts[0]
    second_right = second_parts[1] if len(second_parts) == 2 else None

    first_right_is_date = first_right is not None and (
        _looks_like_date_range(first_right) or (allow_single_date and _looks_like_single_date(first_right))
    )
    second_right_is_date = second_right is not None and (
        _looks_like_date_range(second_right) or (allow_single_date and _looks_like_single_date(second_right))
    )
    first_right_is_location = first_right is not None and _looks_like_location(first_right)
    second_right_is_location = second_right is not None and _looks_like_location(second_right)

    if second_right_is_date and (first_right is None or first_right_is_location):
        return {
            "row1_left": first_left,
            "row1_right": first_right,
            "row2_left": second_left,
            "row2_right": second_right,
            "body_lines": body_lines,
        }

    if first_right_is_date and (second_right is None or second_right_is_location):
        return {
            "row1_left": second_left,
            "row1_right": second_right,
            "row2_left": first_left,
            "row2_right": first_right,
            "body_lines": body_lines,
        }

    raise ValueError("Entry rows do not match the required location/date layout.")


def extract_professional_experience_anchors(content: str) -> list[dict[str, Any]]:
    section = _extract_section(content, PROFESSIONAL_EXPERIENCE_HEADING)
    if not section:
        return []

    anchors: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for block in _section_blocks(section, PROFESSIONAL_EXPERIENCE_HEADING):
        try:
            parsed = _parse_entry_block(block, section_kind="experience")
        except ValueError:
            continue
        title = parsed["row2_left"]
        company = parsed["row1_left"]
        location = parsed["row1_right"] or ""
        date_range = parsed["row2_right"] or ""
        dedupe_key = (
            normalize_text(title),
            normalize_text(company),
            normalize_text(location),
            normalize_text(date_range),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        anchors.append(
            {
                "role_index": len(anchors),
                "source_title": title,
                "source_company": company,
                "source_location": parsed["row1_right"],
                "source_date_range": date_range,
            }
        )
    return anchors


def extract_generated_experience_blocks(section_markdown: str) -> list[dict[str, Any]]:
    extracted_section = _extract_section(section_markdown, PROFESSIONAL_EXPERIENCE_HEADING)
    if extracted_section:
        section_markdown = extracted_section
    blocks: list[dict[str, Any]] = []
    for block in _section_blocks(section_markdown, PROFESSIONAL_EXPERIENCE_HEADING):
        try:
            parsed = _parse_entry_block(block, section_kind="experience")
        except ValueError:
            continue
        blocks.append(
            {
                "lines": block,
                "header": {
                    "company": parsed["row1_left"],
                    "location": parsed["row1_right"] or "",
                    "title": parsed["row2_left"],
                    "date_range": parsed["row2_right"] or "",
                },
                "body_lines": parsed["body_lines"],
            }
        )
    return blocks


def normalize_professional_experience_section(
    *,
    section_markdown: str,
    anchors: list[dict[str, Any]],
    aggressiveness: str,
) -> tuple[str, list[str]]:
    if not anchors:
        return section_markdown.strip(), []

    blocks = extract_generated_experience_blocks(section_markdown)
    if len(blocks) != len(anchors):
        return (
            section_markdown.strip(),
            [
                (
                    "Professional Experience role-block count does not match source anchors "
                    f"({len(blocks)} generated vs {len(anchors)} source)."
                )
            ],
        )

    normalized_blocks: list[str] = []
    for index, block in enumerate(blocks):
        anchor = anchors[index]
        generated_title = block["header"].get("title", "").strip()
        title = str(anchor.get("source_title", "")).strip() if aggressiveness == "low" else generated_title or str(
            anchor.get("source_title", "")
        ).strip()
        company = str(anchor.get("source_company", "")).strip()
        location = str(anchor.get("source_location", "") or "").strip()
        date_range = str(anchor.get("source_date_range", "")).strip()

        role_lines = [f"{company} | {location}" if location else company]
        role_lines.append(f"{title} | {date_range}" if date_range else title)
        role_lines.extend(block["body_lines"])
        while role_lines and not role_lines[-1].strip():
            role_lines.pop()
        normalized_blocks.append("\n".join(role_lines).strip())

    normalized_section = PROFESSIONAL_EXPERIENCE_HEADING + "\n" + "\n\n".join(normalized_blocks)
    return normalized_section.strip(), []


def validate_professional_experience_contract(
    *,
    section_markdown: str,
    anchors: list[dict[str, Any]],
    aggressiveness: str,
) -> list[str]:
    extracted_section = _extract_section(section_markdown, PROFESSIONAL_EXPERIENCE_HEADING)
    if extracted_section:
        section_markdown = extracted_section

    parsed_blocks: list[dict[str, Any]] = []
    errors: list[str] = []
    for index, block in enumerate(_section_blocks(section_markdown, PROFESSIONAL_EXPERIENCE_HEADING)):
        try:
            parsed = _parse_entry_block(block, section_kind="experience")
        except ValueError as exc:
            errors.append(f"Role {index + 1} entry must use the two-row experience format: {exc}")
            continue
        parsed_blocks.append(
            {
                "lines": block,
                "header": {
                    "company": parsed["row1_left"],
                    "location": parsed["row1_right"] or "",
                    "title": parsed["row2_left"],
                    "date_range": parsed["row2_right"] or "",
                },
                "body_lines": parsed["body_lines"],
            }
        )

    if not anchors:
        return errors

    blocks = parsed_blocks
    if len(blocks) != len(anchors):
        errors.append(
            (
                "Professional Experience must preserve the same number of role blocks as the source "
                f"({len(anchors)} required, got {len(blocks)})."
            )
        )
        return errors

    for index, block in enumerate(blocks):
        header = block["header"]
        anchor = anchors[index]

        anchor_title = str(anchor.get("source_title", "")).strip()
        anchor_company = str(anchor.get("source_company", "")).strip()
        anchor_location = str(anchor.get("source_location", "") or "").strip()
        anchor_date = str(anchor.get("source_date_range", "")).strip()

        if normalize_text(header.get("company", "")) != normalize_text(anchor_company):
            errors.append(
                f"Role {index + 1} company must match source value `{anchor_company}`. Got `{header.get('company', '').strip()}`."
            )

        if normalize_text(header.get("date_range", "")) != normalize_text(anchor_date):
            errors.append(
                f"Role {index + 1} date range must match source value `{anchor_date}`. Got `{header.get('date_range', '').strip()}`."
            )

        generated_location = str(header.get("location", "") or "").strip()
        if anchor_location and normalize_text(generated_location) != normalize_text(anchor_location):
            errors.append(
                (
                    f"Role {index + 1} location must match source value `{anchor_location}`. "
                    f"Got `{generated_location}`."
                )
            )

        generated_title = str(header.get("title", "")).strip()
        if aggressiveness == "low" and normalize_text(generated_title) != normalize_text(anchor_title):
            errors.append(
                f"Role {index + 1} title must remain unchanged in low aggressiveness. Expected `{anchor_title}`, got `{generated_title}`."
            )

        if aggressiveness == "medium":
            if not _is_medium_title_grounded_in_source(anchor_title, generated_title):
                errors.append(
                    f"Role {index + 1} title in medium aggressiveness must stay grounded in the source title `{anchor_title}`. Got `{generated_title}`."
                )
            if not _preserves_seniority(anchor_title, generated_title):
                errors.append(
                    f"Role {index + 1} title in medium aggressiveness must preserve source seniority `{anchor_title}`. Got `{generated_title}`."
                )

        if aggressiveness == "high" and not _preserves_seniority(anchor_title, generated_title):
            errors.append(
                f"Role {index + 1} title in high aggressiveness must preserve source seniority `{anchor_title}`. Got `{generated_title}`."
            )

    return errors


def _parse_education_block(block: list[str]) -> dict[str, Any]:
    parsed = _parse_entry_block(block, section_kind="education")
    return {
        "school": parsed["row1_left"],
        "location": parsed["row1_right"] or "",
        "degree": parsed["row2_left"],
        "graduation_date": parsed["row2_right"] or "",
        "body_lines": parsed["body_lines"],
    }


def normalize_education_section(*, section_markdown: str) -> tuple[str, list[str]]:
    if not section_markdown.strip():
        return section_markdown.strip(), []

    issues: list[str] = []
    normalized_blocks: list[str] = []
    for index, block in enumerate(_section_blocks(section_markdown, EDUCATION_HEADING)):
        try:
            parsed = _parse_education_block(block)
        except ValueError as exc:
            issues.append(f"Education entry {index + 1}: {exc}")
            continue
        role_lines = [f"{parsed['school']} | {parsed['location']}" if parsed["location"] else parsed["school"]]
        role_lines.append(
            f"{parsed['degree']} | {parsed['graduation_date']}" if parsed["graduation_date"] else parsed["degree"]
        )
        role_lines.extend(parsed["body_lines"])
        normalized_blocks.append("\n".join(role_lines).strip())

    if issues:
        return section_markdown.strip(), issues
    normalized_section = EDUCATION_HEADING + "\n" + "\n\n".join(normalized_blocks)
    return normalized_section.strip(), []


def validate_education_contract(*, section_markdown: str) -> list[str]:
    errors: list[str] = []
    blocks = _section_blocks(section_markdown, EDUCATION_HEADING)
    for index, block in enumerate(blocks):
        try:
            _parse_education_block(block)
        except ValueError as exc:
            errors.append(f"Education entry {index + 1}: {exc}")
    return errors
