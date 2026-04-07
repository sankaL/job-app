from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional
from urllib.parse import parse_qs, urlparse

from app.db.applications import ApplicationRecord, DuplicateCandidateRecord


REFERENCE_QUERY_KEYS = ("jobid", "job_id", "jobid", "currentjobid", "gh_jid", "jk", "reqid", "requisitionid")
REFERENCE_PATTERNS = (
    re.compile(
        r"(?:job(?:_|-|\s)?id|req(?:uisition)?(?:_|-|\s)?id|gh_jid|jk)[=: /-]*([A-Za-z0-9_-]{4,})",
        re.I,
    ),
    re.compile(r"/jobs/(?:view/)?([0-9]{4,})", re.I),
    re.compile(r"/job/([A-Za-z0-9_-]{6,})", re.I),
)


@dataclass
class DuplicateDecision:
    matched_application_id: str
    similarity_score: float
    matched_fields: list[str]
    match_basis: str


def _normalize(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return round(SequenceMatcher(None, left, right).ratio() * 100, 2)


def extract_reference_id(*values: Optional[str]) -> Optional[str]:
    for value in values:
        if not value:
            continue

        try:
            parsed = urlparse(value)
            query = parse_qs(parsed.query)
            for key, entries in query.items():
                if key.lower() in REFERENCE_QUERY_KEYS:
                    candidate = entries[0].strip()
                    if candidate:
                        return candidate.lower()
        except ValueError:
            pass

        for pattern in REFERENCE_PATTERNS:
            match = pattern.search(value)
            if match:
                return match.group(1).lower()

    return None


def _match_basis(*, exact_url: bool, exact_reference_id: bool, desc_similarity: float, same_origin: bool) -> str:
    if exact_url:
        return "exact_job_url"
    if exact_reference_id:
        return "exact_reference_id"
    if same_origin and desc_similarity >= 65:
        return "job_title_company_with_origin_and_description"
    if same_origin:
        return "job_title_company_with_origin"
    if desc_similarity >= 65:
        return "job_title_company_with_description"
    return "job_title_company"


class DuplicateDetector:
    def __init__(self, threshold: float) -> None:
        self.threshold = threshold

    def evaluate(
        self,
        *,
        application: ApplicationRecord,
        candidates: list[DuplicateCandidateRecord],
    ) -> Optional[DuplicateDecision]:
        if not application.job_title or not application.company:
            return None

        normalized_current = _normalize(f"{application.job_title} {application.company}")
        current_origin = _normalize(application.job_posting_origin)
        current_url = _normalize(application.job_url)
        current_description = _normalize((application.job_description or "")[:3000])
        current_reference_id = _normalize(application.extracted_reference_id) or extract_reference_id(
            application.job_url,
            application.job_description,
        )

        best_match: Optional[DuplicateDecision] = None

        for candidate in candidates:
            if not candidate.job_title or not candidate.company:
                continue

            candidate_title_company = _normalize(f"{candidate.job_title} {candidate.company}")
            title_company_similarity = _similarity(normalized_current, candidate_title_company)
            candidate_origin = _normalize(candidate.job_posting_origin)
            candidate_url = _normalize(candidate.job_url)
            candidate_description = _normalize((candidate.job_description or "")[:3000])
            candidate_reference_id = _normalize(candidate.extracted_reference_id) or extract_reference_id(
                candidate.job_url,
                candidate.job_description,
            )
            desc_similarity = _similarity(current_description, candidate_description)
            same_origin = bool(current_origin and candidate_origin and current_origin == candidate_origin)
            exact_url = bool(current_url and candidate_url and current_url == candidate_url)
            exact_reference_id = bool(
                current_reference_id
                and candidate_reference_id
                and current_reference_id == candidate_reference_id
            )

            matched_fields = ["job_title", "company"]
            score = title_company_similarity

            if exact_url:
                matched_fields.append("job_url")
                score = max(score, 99.0)

            if exact_reference_id:
                matched_fields.append("reference_id")
                score = max(score, 95.0)

            if same_origin:
                matched_fields.append("job_posting_origin")
                score += 4
            elif current_origin and candidate_origin and current_origin != candidate_origin:
                score -= 12

            if desc_similarity >= 80:
                matched_fields.append("job_description")
                score += 6
            elif desc_similarity >= 65:
                matched_fields.append("job_description")
                score += 2
            elif current_description and candidate_description and desc_similarity < 40:
                score -= 18

            score = max(0.0, min(100.0, round(score, 2)))

            if not exact_url and not exact_reference_id and title_company_similarity < self.threshold:
                continue

            if (
                not exact_url
                and not exact_reference_id
                and current_description
                and candidate_description
                and desc_similarity < 45
                and not same_origin
            ):
                continue

            if score < self.threshold:
                continue

            decision = DuplicateDecision(
                matched_application_id=candidate.id,
                similarity_score=score,
                matched_fields=matched_fields,
                match_basis=_match_basis(
                    exact_url=exact_url,
                    exact_reference_id=exact_reference_id,
                    desc_similarity=desc_similarity,
                    same_origin=same_origin,
                ),
            )
            if best_match is None or decision.similarity_score > best_match.similarity_score:
                best_match = decision

        return best_match
