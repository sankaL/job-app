"""Advisory contact extraction, entirely local and separate from source sections."""
from __future__ import annotations

import re

from app.services.resume_privacy import CONTACT_SECTION_HEADINGS, EMAIL_RE, PHONE_RE, sanitize_resume_markdown

LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[^\s|)>]+", re.I)
ADDRESS_RE = re.compile(r"\b(?:address\s*:|\d+\s+[^\n|]+\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?))", re.I)
CITY_REGION_RE = re.compile(r"^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:\s+\d[\d -]*|\s+[A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d)?$")


def extract_contact_suggestions(content_md: str) -> dict[str, str]:
    """Do not invent values or write to the profile; return source excerpts only."""
    sanitized = sanitize_resume_markdown(content_md)
    candidates = [line.strip() for line in [*sanitized.header_lines, *sanitized.removed_contact_lines] if line.strip()]
    result: dict[str, str] = {}
    for line in candidates:
        plain = re.sub(r"^[#*\s]+|[*\s]+$", "", line)
        if plain.casefold() in CONTACT_SECTION_HEADINGS:
            continue
        email = EMAIL_RE.search(plain)
        phone = PHONE_RE.search(plain)
        linkedin = LINKEDIN_RE.search(plain)
        if email and "email" not in result:
            result["email"] = email.group(0)[:320]
        if phone and "phone" not in result:
            result["phone"] = phone.group(0).strip()[:100]
        if linkedin and "linkedin" not in result:
            result["linkedin"] = linkedin.group(0).rstrip(".,")[:2000]
        if email or phone or linkedin:
            continue
        if "address" not in result and (ADDRESS_RE.search(plain) or CITY_REGION_RE.fullmatch(plain)):
            result["address"] = re.sub(r"^address\s*:\s*", "", plain, flags=re.I)[:2000]
            continue
        name = re.sub(r"^name\s*:\s*", "", plain, flags=re.I)
        words = name.split()
        if "name" not in result and 1 < len(words) <= 4 and all(word[:1].isupper() and not any(char.isdigit() for char in word) for word in words) and ":" not in name:
            result["name"] = name[:200]
    return result
