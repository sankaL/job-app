"""Deterministic ATS keyword matching, identical to the backend's coverage rule.

A keyword matches only as the exact stored phrase: case-insensitive, whitespace-flexible, with no
alphanumeric neighbour on either side. Synonyms, plurals and stemming never count. The backend
(`ApplicationManager._keyword_regex`) owns the product rule; tests on both sides pin the same cases.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable


@lru_cache(maxsize=512)
def keyword_regex(keyword: str) -> re.Pattern[str]:
    normalized = re.sub(r"\s+", " ", keyword).strip().lower()
    escaped = re.escape(normalized).replace(r"\ ", r"\s+")
    prefix = r"(?<![a-z0-9])" if normalized else ""
    suffix = r"(?![a-z0-9])" if normalized else ""
    return re.compile(f"{prefix}{escaped}{suffix}", re.I)


def match_keywords(keywords: Iterable[str], text: str) -> dict[str, object]:
    searchable = re.sub(r"\s+", " ", str(text or "")).strip().lower()
    unique = list(dict.fromkeys(str(value).strip() for value in keywords if str(value).strip()))
    matched = [keyword for keyword in unique if keyword_regex(keyword).search(searchable)]
    missing = [keyword for keyword in unique if keyword not in matched]
    total = len(unique)
    return {"matched_keywords": matched, "missing_keywords": missing, "matched_count": len(matched),
            "total_count": total, "percentage": round(len(matched) / total * 100, 1) if total else 0.0}
