from __future__ import annotations

import re
from dataclasses import dataclass

COMMON_SECTION_HEADINGS = {
    "summary",
    "professional summary",
    "objective",
    "experience",
    "work experience",
    "professional experience",
    "education",
    "skills",
    "technical skills",
    "projects",
    "certifications",
    "awards",
    "publications",
    "languages",
    "interests",
}

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(
    r"(?:(?:\+?\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4})"
)
URL_RE = re.compile(
    r"(?:https?://|www\.|linkedin\.com/|github\.com/|gitlab\.com/|portfolio\.|behance\.net/|dribbble\.com/)",
    re.I,
)
CONTACT_URL_RE = re.compile(
    r"(?:linkedin\.com/|github\.com/|gitlab\.com/|portfolio\.|behance\.net/|dribbble\.com/)",
    re.I,
)
CONTACT_MARKER_RE = re.compile(r"\b(?:email|phone|mobile|address|location|city|linkedin|github|portfolio)\b", re.I)
CONTACT_SECTION_HEADINGS = {
    "contact", "contacts", "contact information", "contact info", "contact details",
    "personal information", "personal info", "personal details",
}


@dataclass(frozen=True)
class SanitizedResume:
    sanitized_markdown: str
    header_lines: list[str]
    removed_contact_lines: list[str]


def _normalize_heading(line: str) -> str:
    return re.sub(r"[^a-z ]+", "", line.strip().lstrip("#").strip().lower())


def _is_resume_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith("## "):
        return True
    if stripped.startswith("# "):
        return False

    normalized = _normalize_heading(stripped)
    if normalized in COMMON_SECTION_HEADINGS:
        return True

    letters = [char for char in stripped if char.isalpha()]
    if not letters:
        return False
    uppercase_ratio = sum(1 for char in letters if char.isupper()) / len(letters)
    return uppercase_ratio >= 0.8 and len(stripped.split()) <= 4


def _looks_like_name(line: str) -> bool:
    original = line.strip()
    if original.startswith("##"):
        return False
    stripped = original
    if stripped.startswith("# "):
        stripped = stripped[2:].strip()
    if not stripped:
        return False
    if any(char.isdigit() for char in stripped):
        return False
    if EMAIL_RE.search(stripped) or URL_RE.search(stripped) or PHONE_RE.search(stripped):
        return False
    words = [word for word in stripped.split() if word]
    if not 1 < len(words) <= 4:
        return False
    return all(word[:1].isupper() for word in words if word[:1].isalpha())


def _is_contact_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    lowered = stripped.lower()
    is_bullet = stripped.startswith(("- ", "* ", "+ "))
    if EMAIL_RE.search(stripped) or PHONE_RE.search(stripped):
        return True
    if "|" in stripped and CONTACT_MARKER_RE.search(stripped):
        return True
    if not is_bullet and CONTACT_URL_RE.search(stripped):
        return True
    if not is_bullet and any(marker in lowered for marker in ("email:", "phone:", "address:", "location:")):
        return True
    return False


def _is_body_contact_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if EMAIL_RE.search(stripped) or PHONE_RE.search(stripped):
        return True
    if stripped.startswith(("- ", "* ", "+ ")):
        return False
    lowered = stripped.lower()
    return any(marker in lowered for marker in ("email:", "phone:", "address:", "location:"))


def sanitize_resume_markdown(content: str) -> SanitizedResume:
    lines = content.splitlines()
    header_lines: list[str] = []
    removed_contact_lines: list[str] = []

    first_section_index = next((index for index, line in enumerate(lines) if _is_resume_heading(line)), None)
    if first_section_index is not None and first_section_index > 0:
        candidate_header = lines[:first_section_index]
        if any(_is_contact_line(line) for line in candidate_header) or any(
            _looks_like_name(line) for line in candidate_header if line.strip()
        ):
            header_lines = candidate_header
            lines = lines[first_section_index:]
    elif first_section_index is None and lines:
        probe: list[str] = []
        for line in lines[:10]:
            if probe and not line.strip():
                break
            probe.append(line)
        contact_indexes = [index for index, line in enumerate(probe) if _is_contact_line(line)]
        if contact_indexes:
            # Without a section boundary, only remove the supported contact
            # prefix. Unknown resume facts after it must remain recoverable.
            header_end = max(contact_indexes) + 1
            header_lines = probe[:header_end]
            lines = lines[header_end:]
        elif probe and probe[0].startswith("# ") and _looks_like_name(probe[0]):
            header_lines = probe[:1]
            lines = lines[1:]

    kept_lines: list[str] = []
    in_contact_section = False
    for line in lines:
        if line.strip().startswith("## "):
            in_contact_section = _normalize_heading(line) in CONTACT_SECTION_HEADINGS
            if in_contact_section:
                removed_contact_lines.append(line)
                continue
        if in_contact_section:
            removed_contact_lines.append(line)
            continue
        if _is_body_contact_line(line):
            removed_contact_lines.append(line)
            continue
        kept_lines.append(line)

    sanitized = "\n".join(kept_lines).strip()
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    if sanitized:
        sanitized += "\n"

    return SanitizedResume(
        sanitized_markdown=sanitized,
        header_lines=[line for line in header_lines if line.strip()],
        removed_contact_lines=[line for line in removed_contact_lines if line.strip()],
    )


def reattach_header_lines(content: str, header_lines: list[str]) -> str:
    body = content.strip()
    header_block = "\n".join(line.rstrip() for line in header_lines if line.strip()).strip()
    if header_block and body:
        return f"{header_block}\n\n{body}\n"
    if header_block:
        return f"{header_block}\n"
    if body:
        return f"{body}\n"
    return ""
