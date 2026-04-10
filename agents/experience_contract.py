"""Deterministic Professional Experience structure contract helpers."""

from __future__ import annotations

import re
from typing import Any, Optional

PROFESSIONAL_EXPERIENCE_HEADING = "## Professional Experience"

DATE_RANGE_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b"
    r"|\b\d{4}\s*[-/]\s*(?:\d{4}|present)\b"
    r"|\b(?:present|current)\b",
    re.I,
)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _strip_inline_markdown(value: str) -> str:
    cleaned = re.sub(r"[`*_]", "", value)
    cleaned = re.sub(r"\[(.*?)\]\([^)]*\)", r"\1", cleaned)
    return cleaned.strip()


def _looks_like_date_range(value: str) -> bool:
    return DATE_RANGE_RE.search(value) is not None


def _extract_professional_experience_section(content: str) -> Optional[str]:
    pattern = re.compile(
        r"(^##\s*Professional\s+Experience\s*$\n.*?)(?=^##\s|\Z)",
        re.I | re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(content)
    if not match:
        return None
    return match.group(1).strip()


def parse_role_header_line(line: str) -> Optional[dict[str, str]]:
    stripped = line.strip()
    if not stripped:
        return None

    stripped = re.sub(r"^[-*+]\s+", "", stripped)
    stripped = _strip_inline_markdown(stripped)

    if "|" in stripped:
        parts = [part.strip() for part in stripped.split("|") if part.strip()]
        if len(parts) >= 3:
            title = parts[0]
            company = parts[1]
            date_range = parts[-1]
            if title and company and _looks_like_date_range(date_range):
                return {
                    "title": title,
                    "company": company,
                    "date_range": date_range,
                }

        if len(parts) == 2:
            left, date_range = parts
            at_match = re.match(r"^(.+?)\s+at\s+(.+)$", left, re.I)
            if at_match and _looks_like_date_range(date_range):
                return {
                    "title": at_match.group(1).strip(),
                    "company": at_match.group(2).strip(),
                    "date_range": date_range,
                }

    at_match = re.match(r"^(.+?)\s+at\s+(.+?)\s*[-|]\s*(.+)$", stripped, re.I)
    if at_match and _looks_like_date_range(at_match.group(3)):
        return {
            "title": at_match.group(1).strip(),
            "company": at_match.group(2).strip(),
            "date_range": at_match.group(3).strip(),
        }

    return None


def extract_professional_experience_anchors(content: str) -> list[dict[str, Any]]:
    section = _extract_professional_experience_section(content)
    if not section:
        return []

    lines = section.splitlines()
    if lines and lines[0].strip().lower().startswith("## professional experience"):
        lines = lines[1:]

    anchors: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for line in lines:
        parsed = parse_role_header_line(line)
        if not parsed:
            continue

        dedupe_key = (
            normalize_text(parsed["title"]),
            normalize_text(parsed["company"]),
            normalize_text(parsed["date_range"]),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        anchors.append(
            {
                "role_index": len(anchors),
                "source_title": parsed["title"],
                "source_company": parsed["company"],
                "source_date_range": parsed["date_range"],
            }
        )

    return anchors


def extract_generated_experience_blocks(section_markdown: str) -> list[dict[str, Any]]:
    if not section_markdown.strip():
        return []

    lines = section_markdown.strip().splitlines()
    if lines and lines[0].strip().lower().startswith("## professional experience"):
        lines = lines[1:]

    blocks: list[dict[str, Any]] = []
    current_lines: list[str] = []

    for line in lines:
        parsed = parse_role_header_line(line)
        if parsed:
            if current_lines:
                header = parse_role_header_line(current_lines[0])
                if header:
                    blocks.append({"lines": current_lines, "header": header})
            current_lines = [line]
            continue

        if current_lines:
            current_lines.append(line)

    if current_lines:
        header = parse_role_header_line(current_lines[0])
        if header:
            blocks.append({"lines": current_lines, "header": header})

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
        header = block["header"]
        generated_title = header.get("title", "")

        if aggressiveness in {"low", "medium"}:
            title = str(anchor.get("source_title", generated_title)).strip()
        else:
            title = generated_title.strip() or str(anchor.get("source_title", "")).strip()

        company = str(anchor.get("source_company", "")).strip()
        date_range = str(anchor.get("source_date_range", "")).strip()
        rebuilt_header = f"{title} | {company} | {date_range}"

        role_lines = [rebuilt_header]
        role_lines.extend(block["lines"][1:])
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
    if not anchors:
        return []

    blocks = extract_generated_experience_blocks(section_markdown)
    if len(blocks) != len(anchors):
        return [
            (
                "Professional Experience must preserve the same number of role blocks as the source "
                f"({len(anchors)} required, got {len(blocks)})."
            )
        ]

    errors: list[str] = []
    for index, block in enumerate(blocks):
        header = block["header"]
        anchor = anchors[index]

        anchor_title = str(anchor.get("source_title", "")).strip()
        anchor_company = str(anchor.get("source_company", "")).strip()
        anchor_date = str(anchor.get("source_date_range", "")).strip()

        if normalize_text(header.get("company", "")) != normalize_text(anchor_company):
            errors.append(
                (
                    f"Role {index + 1} company must match source value `{anchor_company}`. "
                    f"Got `{header.get('company', '').strip()}`."
                )
            )

        if normalize_text(header.get("date_range", "")) != normalize_text(anchor_date):
            errors.append(
                (
                    f"Role {index + 1} date range must match source value `{anchor_date}`. "
                    f"Got `{header.get('date_range', '').strip()}`."
                )
            )

        if aggressiveness in {"low", "medium"} and normalize_text(header.get("title", "")) != normalize_text(anchor_title):
            errors.append(
                (
                    f"Role {index + 1} title must remain unchanged in {aggressiveness} aggressiveness. "
                    f"Expected `{anchor_title}`, got `{header.get('title', '').strip()}`."
                )
            )

    return errors
