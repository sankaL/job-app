from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Optional


RENDER_CONTRACT_VERSION = "2026-04-19.v1"

SECTION_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
TOP_HEADING_RE = re.compile(r"^#\s+(.+?)\s*$")
BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?:\+\d[\d\s().-]{6,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})")
LINKEDIN_RE = re.compile(r"linkedin\.com/|(?:^|[\s|])(?:in|pub|company)/", re.I)
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
INSTITUTION_RE = re.compile(
    r"\b(?:university|college|institute|school|academy|polytechnic|conservatory)\b",
    re.I,
)
DEGREE_RE = re.compile(
    r"\b(?:bachelor|master|doctor|phd|mba|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree|certificate|diploma)\b",
    re.I,
)
STRUCTURED_SECTION_KINDS = {
    "professional experience": "professional_experience",
    "education": "education",
}


@dataclass(frozen=True)
class RenderHeader:
    name: Optional[str] = None
    contact_line: Optional[str] = None
    extra_lines: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RenderEntry:
    row1_left: str
    row1_right: Optional[str]
    row2_left: str
    row2_right: Optional[str]
    bullets: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RenderSection:
    heading: str
    kind: str
    markdown_body: Optional[str] = None
    entries: list[RenderEntry] = field(default_factory=list)


@dataclass(frozen=True)
class RenderDocument:
    render_contract_version: str
    header: Optional[RenderHeader]
    sections: list[RenderSection]
    normalized_markdown: str

    def to_payload(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class RenderBuildResult:
    document: Optional[RenderDocument]
    normalized_markdown: str
    error: Optional[str] = None


def _strip_inline_markdown(value: str) -> str:
    cleaned = re.sub(r"[`*_]", "", value)
    cleaned = re.sub(r"\[(.*?)\]\([^)]*\)", r"\1", cleaned)
    return cleaned.strip()


def _split_pipe_line(line: str) -> list[str]:
    return [part.strip() for part in line.split("|") if part.strip()]


def _is_contactish_line(line: str) -> bool:
    return bool("|" in line or EMAIL_RE.search(line) or PHONE_RE.search(line) or LINKEDIN_RE.search(line))


def _looks_like_date(value: str, *, allow_single_date: bool) -> bool:
    normalized = _strip_inline_markdown(value)
    if not normalized:
        return False
    if DATE_RANGE_RE.search(normalized):
        return True
    return allow_single_date and SINGLE_DATE_RE.search(normalized) is not None


def _looks_like_location(value: str) -> bool:
    normalized = _strip_inline_markdown(value)
    if not normalized or _looks_like_date(normalized, allow_single_date=True):
        return False
    if re.search(r"\b(remote|hybrid|onsite|on-site|usa|canada|uk|united states|united kingdom)\b", normalized, re.I):
        return True
    if "," in normalized:
        return True
    if "/" in normalized:
        return True
    if re.search(r"\b[A-Z]{2}\b", normalized):
        return True
    words = normalized.split()
    return 1 <= len(words) <= 5


def _looks_like_institution(value: str) -> bool:
    normalized = _strip_inline_markdown(value)
    return bool(INSTITUTION_RE.search(normalized))


def _looks_like_degree(value: str) -> bool:
    normalized = _strip_inline_markdown(value)
    return bool(DEGREE_RE.search(normalized))


def _normalize_header_and_body(markdown_content: str) -> tuple[Optional[RenderHeader], list[tuple[str, list[str]]], list[str]]:
    stripped = markdown_content.strip("\n")
    if not stripped:
        return None, [], []

    lines = stripped.splitlines()
    first_section_index = next(
        (index for index, line in enumerate(lines) if SECTION_HEADING_RE.match(line.strip())),
        len(lines),
    )
    preamble_lines = lines[:first_section_index]
    body_lines = lines[first_section_index:]

    header: Optional[RenderHeader] = None
    nonblank_preamble = [line.rstrip() for line in preamble_lines if line.strip()]
    if nonblank_preamble:
        first = nonblank_preamble[0].strip()
        name = None
        contact_line = None
        extra_lines: list[str] = []
        top_heading_match = TOP_HEADING_RE.match(first)
        if top_heading_match:
            name = top_heading_match.group(1).strip()
            remaining = nonblank_preamble[1:]
        else:
            name = first
            remaining = nonblank_preamble[1:]
        for line in remaining:
            if contact_line is None and _is_contactish_line(line.strip()):
                contact_line = line.strip()
            else:
                extra_lines.append(line.strip())
        header = RenderHeader(name=name or None, contact_line=contact_line, extra_lines=extra_lines)

    sections: list[tuple[str, list[str]]] = []
    current_heading: Optional[str] = None
    current_lines: list[str] = []
    for line in body_lines:
        match = SECTION_HEADING_RE.match(line.strip())
        if match:
            if current_heading is not None:
                sections.append((current_heading, current_lines))
            current_heading = match.group(1).strip()
            current_lines = []
        elif current_heading is not None:
            current_lines.append(line.rstrip())
    if current_heading is not None:
        sections.append((current_heading, current_lines))

    return header, sections, nonblank_preamble


def _blocks_from_lines(lines: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)
    return blocks


def _parse_structured_entry_block(block: list[str], *, section_kind: str) -> RenderEntry:
    header_lines: list[str] = []
    bullet_lines: list[str] = []
    for line in block:
        bullet_match = BULLET_RE.match(line.strip())
        if bullet_match:
            bullet_lines.append(bullet_match.group(1).strip())
            continue
        if bullet_lines:
            bullet_lines[-1] = f"{bullet_lines[-1]}\n{line.rstrip()}"
            continue
        header_lines.append(line.strip())

    allow_single_date = section_kind == "education"

    if len(header_lines) == 1:
        parts = _split_pipe_line(header_lines[0])
        if len(parts) != 3 or not _looks_like_date(parts[2], allow_single_date=allow_single_date):
            raise ValueError("Structured entry must have two canonical rows or one supported legacy three-part row.")
        first, second, right = parts
        if section_kind == "education":
            if _looks_like_institution(first) and not _looks_like_institution(second):
                row1_left, row2_left = first, second
            elif _looks_like_institution(second):
                row1_left, row2_left = second, first
            elif _looks_like_degree(first) and not _looks_like_degree(second):
                row1_left, row2_left = second, first
            elif _looks_like_degree(second) and not _looks_like_degree(first):
                row1_left, row2_left = first, second
            else:
                row1_left, row2_left = first, second
            return RenderEntry(
                row1_left=row1_left,
                row1_right=None,
                row2_left=row2_left,
                row2_right=right,
                bullets=bullet_lines,
            )
        return RenderEntry(
            row1_left=second,
            row1_right=None,
            row2_left=first,
            row2_right=right,
            bullets=bullet_lines,
        )

    if len(header_lines) != 2:
        raise ValueError("Structured entry must have exactly two header rows.")

    first_parts = _split_pipe_line(header_lines[0])
    second_parts = _split_pipe_line(header_lines[1])
    if len(first_parts) == 1:
        first_left, first_right = first_parts[0], None
    elif len(first_parts) == 2:
        first_left, first_right = first_parts
    else:
        raise ValueError("First structured row is malformed.")

    if len(second_parts) == 1:
        second_left, second_right = second_parts[0], None
    elif len(second_parts) == 2:
        second_left, second_right = second_parts
    else:
        raise ValueError("Second structured row is malformed.")

    first_right_is_date = first_right is not None and _looks_like_date(first_right, allow_single_date=allow_single_date)
    second_right_is_date = second_right is not None and _looks_like_date(second_right, allow_single_date=allow_single_date)
    first_right_is_location = first_right is not None and _looks_like_location(first_right)
    second_right_is_location = second_right is not None and _looks_like_location(second_right)

    # Dates can be absent from a reviewed source. Canonical row order still
    # carries company/institution, then role/qualification without inventing one.
    if second_right is None and (first_right is None or first_right_is_location):
        return RenderEntry(row1_left=first_left, row1_right=first_right, row2_left=second_left, row2_right=None, bullets=bullet_lines)

    if second_right_is_date and (first_right is None or first_right_is_location):
        return RenderEntry(
            row1_left=first_left,
            row1_right=first_right,
            row2_left=second_left,
            row2_right=second_right,
            bullets=bullet_lines,
        )

    if first_right_is_date and (second_right is None or second_right_is_location):
        return RenderEntry(
            row1_left=second_left,
            row1_right=second_right,
            row2_left=first_left,
            row2_right=first_right,
            bullets=bullet_lines,
        )

    raise ValueError("Structured entry rows do not match the required location/date alignment contract.")


def _normalize_structured_entries(
    *,
    heading: str,
    section_kind: str,
    lines: list[str],
) -> RenderSection:
    blocks = _blocks_from_lines(lines)
    if not blocks:
        return RenderSection(heading=heading, kind=section_kind, entries=[])

    entries = [_parse_structured_entry_block(block, section_kind=section_kind) for block in blocks]
    return RenderSection(heading=heading, kind=section_kind, entries=entries)


def _normalize_markdown_section(*, heading: str, lines: list[str]) -> RenderSection:
    body = "\n".join(lines).strip("\n")
    return RenderSection(heading=heading, kind="markdown", markdown_body=body)


def _serialize_header(header: Optional[RenderHeader]) -> list[str]:
    if header is None:
        return []
    lines: list[str] = []
    if header.name:
        lines.append(f"# {header.name}")
    if header.contact_line:
        lines.append(header.contact_line)
    lines.extend(line for line in header.extra_lines if line)
    return lines


def _serialize_entry(entry: RenderEntry) -> list[str]:
    lines = [entry.row1_left if not entry.row1_right else f"{entry.row1_left} | {entry.row1_right}"]
    lines.append(entry.row2_left if not entry.row2_right else f"{entry.row2_left} | {entry.row2_right}")
    lines.extend(f"- {bullet}" for bullet in entry.bullets if bullet)
    return lines


def _serialize_document(header: Optional[RenderHeader], sections: list[RenderSection]) -> str:
    lines: list[str] = []
    header_lines = _serialize_header(header)
    if header_lines:
        lines.extend(header_lines)
        lines.append("")

    for index, section in enumerate(sections):
        lines.append(f"## {section.heading}")
        if section.kind in STRUCTURED_SECTION_KINDS.values():
            for entry_index, entry in enumerate(section.entries):
                lines.extend(_serialize_entry(entry))
                if entry_index < len(section.entries) - 1:
                    lines.append("")
        elif section.markdown_body:
            lines.extend(section.markdown_body.splitlines())
        if index < len(sections) - 1:
            lines.append("")

    return "\n".join(lines).rstrip("\n") + ("\n" if lines else "")


def build_render_document(markdown_content: str) -> RenderBuildResult:
    header, section_pairs, _preamble = _normalize_header_and_body(markdown_content)
    errors: list[str] = []
    sections: list[RenderSection] = []

    for heading, lines in section_pairs:
        section_kind = STRUCTURED_SECTION_KINDS.get(heading.strip().lower())
        if section_kind is None:
            sections.append(_normalize_markdown_section(heading=heading, lines=lines))
            continue
        try:
            sections.append(
                _normalize_structured_entries(
                    heading=heading,
                    section_kind=section_kind,
                    lines=lines,
                )
            )
        except ValueError as exc:
            errors.append(f"{heading}: {exc}")

    if errors:
        return RenderBuildResult(
            document=None,
            normalized_markdown=markdown_content.rstrip("\n") + ("\n" if markdown_content.strip() else ""),
            error=" ".join(errors),
        )

    normalized_markdown = _serialize_document(header, sections)
    return RenderBuildResult(
        document=RenderDocument(
            render_contract_version=RENDER_CONTRACT_VERSION,
            header=header,
            sections=sections,
            normalized_markdown=normalized_markdown,
        ),
        normalized_markdown=normalized_markdown,
        error=None,
    )


def normalize_resume_markdown(markdown_content: str) -> str:
    build_result = build_render_document(markdown_content)
    if build_result.error:
        raise ValueError(build_result.error)
    return build_result.normalized_markdown
