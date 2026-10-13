from __future__ import annotations

import re
import unicodedata
from typing import Mapping, Optional
from urllib.parse import quote

DEFAULT_FILENAME_TEMPLATE = "{first name} {last name} Resume"
MAX_TEMPLATE_LENGTH = 120
MAX_FILENAME_STEM_LENGTH = 120

FILENAME_PLACEHOLDERS = ("first name", "last name", "full name", "company", "job title")

_PLACEHOLDER_RE = re.compile(r"\{([^{}]*)\}")
_ALLOWED_PUNCTUATION = frozenset(" .&()-")
_WHITESPACE_RE = re.compile(r"\s+")
# Windows refuses these as file names even with an extension.
_WINDOWS_RESERVED_STEMS = frozenset(
    {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
)


def _is_allowed_char(char: str) -> bool:
    # Letters, combining marks (e.g. Devanagari/Sinhala vowel signs) and numbers are kept;
    # everything else, including underscores, becomes a space.
    return char in _ALLOWED_PUNCTUATION or unicodedata.category(char)[0] in {"L", "M", "N"}


def _normalize_placeholder(token: str) -> str:
    return _WHITESPACE_RE.sub(" ", token.strip().lower())


def normalize_template(template: Optional[str]) -> Optional[str]:
    """Trim a user-supplied template; blank means "use the default" and is stored as ``None``."""
    if template is None:
        return None
    trimmed = template.strip()
    return trimmed or None


def validate_template(template: Optional[str]) -> Optional[str]:
    """Validate and normalize a base-resume file name template. Raises ``ValueError`` when invalid."""
    normalized = normalize_template(template)
    if normalized is None:
        return None
    if len(normalized) > MAX_TEMPLATE_LENGTH:
        raise ValueError(f"File name must be {MAX_TEMPLATE_LENGTH} characters or fewer.")
    if normalized.count("{") != normalized.count("}"):
        raise ValueError("File name has an unmatched { or }.")
    for match in _PLACEHOLDER_RE.finditer(normalized):
        if _normalize_placeholder(match.group(1)) not in FILENAME_PLACEHOLDERS:
            allowed = ", ".join(f"{{{name}}}" for name in FILENAME_PLACEHOLDERS)
            raise ValueError(f"Unknown placeholder {match.group(0)}. Use one of: {allowed}.")
    literal_text = _clean_stem(_PLACEHOLDER_RE.sub(" ", normalized))
    if not literal_text and not _PLACEHOLDER_RE.search(normalized):
        raise ValueError("File name must contain letters or numbers.")
    return normalized


def split_full_name(full_name: Optional[str]) -> tuple[str, str]:
    parts = (full_name or "").split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[-1]


def build_filename_values(
    *,
    full_name: Optional[str],
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company: Optional[str] = None,
    job_title: Optional[str] = None,
) -> dict[str, str]:
    """First/last come from the resume name (what the header prints), then the onboarding fields."""
    split_first, split_last = split_full_name(full_name)
    first = split_first or (first_name or "").strip()
    last = split_last or (last_name or "").strip()
    full = " ".join((full_name or "").split()) or " ".join(part for part in (first, last) if part)
    return {
        "first name": first,
        "last name": last,
        "full name": full,
        "company": (company or "").strip(),
        "job title": (job_title or "").strip(),
    }


def _clean_stem(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    value = "".join(char if _is_allowed_char(char) else " " for char in value)
    value = _WHITESPACE_RE.sub(" ", value).strip(" .-")
    if len(value) > MAX_FILENAME_STEM_LENGTH:
        value = value[:MAX_FILENAME_STEM_LENGTH].rstrip(" .-")
    if value.upper() in _WINDOWS_RESERVED_STEMS:
        value = f"{value} Resume"
    return value


def _substitute(template: str, values: Mapping[str, str]) -> str:
    return _PLACEHOLDER_RE.sub(lambda match: values.get(_normalize_placeholder(match.group(1)), ""), template)


def render_filename(template: Optional[str], values: Mapping[str, str], extension: str) -> str:
    """Render a clean download file name such as ``Sanka Lokuliyana Resume.pdf``."""
    stem = ""
    normalized = normalize_template(template)
    if normalized is not None:
        stem = _clean_stem(_substitute(normalized, values))
    if not stem:
        stem = _clean_stem(_substitute(DEFAULT_FILENAME_TEMPLATE, values))
    if not stem:
        stem = "Resume"
    return f"{stem}.{extension.lstrip('.').lower()}"


def content_disposition(filename: str) -> str:
    """Attachment header with an ASCII fallback plus the RFC 5987 UTF-8 form for accented names."""
    ascii_fallback = (
        unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii").replace('"', "")
    )
    ascii_fallback = _WHITESPACE_RE.sub(" ", ascii_fallback).strip() or "Resume"
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
