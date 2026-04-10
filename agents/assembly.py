"""Resume assembly service.

Combines a personal-info header with ordered generated sections into a
single clean Markdown document.
"""

from __future__ import annotations

import re
from typing import Any, Optional


def _clean_personal_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _format_linkedin_value(value: Any) -> str:
    linkedin = _clean_personal_value(value)
    if not linkedin:
        return ""

    normalized = re.sub(r"^https?://", "", linkedin, flags=re.I)
    normalized = re.sub(r"^www\.", "", normalized, flags=re.I).rstrip("/")
    match = re.search(r"linkedin\.com/(in|pub|company)/(.+)", normalized, re.I)
    if match:
        return f"{match.group(1).lower()}/{match.group(2).strip('/')}"
    return normalized


def assemble_resume(
    *,
    personal_info: dict[str, Any],
    generated_sections: list[dict[str, str]],
) -> str:
    """Assemble final Markdown from personal info header + ordered sections.

    Args:
        personal_info: ``{"name": str, "email": str, "phone": str|None, "address": str|None, "linkedin_url": str|None}``
        generated_sections: ``[{"name": str, "content": str}]`` already in order.

    Returns:
        Complete Markdown resume string.  Personal info MUST come from the
        profile, NOT from LLM generation.
    """

    lines: list[str] = []

    # -- Header: name --
    name = _clean_personal_value(personal_info.get("name"))
    if name:
        lines.append(f"# {name}")

    # -- Contact line --
    contact_parts: list[str] = []
    email = _clean_personal_value(personal_info.get("email"))
    if email:
        contact_parts.append(email)
    phone = _clean_personal_value(personal_info.get("phone"))
    if phone:
        contact_parts.append(phone)
    address = _clean_personal_value(personal_info.get("address"))
    if address:
        contact_parts.append(address)
    linkedin = _format_linkedin_value(personal_info.get("linkedin_url"))
    if linkedin:
        contact_parts.append(linkedin)

    if contact_parts:
        lines.append(" | ".join(contact_parts))

    # -- Blank separator --
    lines.append("")

    # -- Sections --
    for section in generated_sections:
        content = section.get("content", "").strip()
        if content:
            lines.append(content)
            lines.append("")  # blank line between sections

    return "\n".join(lines).rstrip("\n") + "\n"
