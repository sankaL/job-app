"""Hand-written synthetic source facts and evaluation cases. No user data."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from resume_document import render_resume_document, validate_resume_document


PRIVACY_VALUES = ["Morgan Synthetic", "morgan.synthetic@example.test", "72 Fictional Lane"]
UNSUPPORTED_TERMS = ["Rust", "Kubernetes", "AWS", "CPA", "patent", "million"]
JOB_DESCRIPTION = (
    "Fictional Northstar Tools seeks a backend engineer to build Python REST APIs, "
    "FastAPI services, PostgreSQL queries, automated testing, and documentation. "
    "Rust, Kubernetes and AWS experience are preferred. CPA certification is optional. "
    "These preferred requirements do not establish any candidate experience."
)


def source_document() -> dict[str, Any]:
    return validate_resume_document({"schema_version": 1, "revision": 7, "sections": [
        {"id": "summary", "kind": "summary", "heading": "Summary", "review_state": "reviewed",
         "content_md": "Backend developer building Python REST APIs with FastAPI and PostgreSQL."},
        {"id": "experience", "kind": "professional_experience", "heading": "Professional Experience",
         "review_state": "reviewed", "entries": [
            {"id": "role-one", "fields": {"title": "Backend Developer", "company": "Fictional Cedar Labs",
             "location": "Toronto", "date_range": "2021 - 2024"}, "bullets": [
                {"id": "api-latency", "text": "Built Python REST APIs with FastAPI, reducing p95 request latency by 35%."},
                {"id": "query-work", "text": "Optimized PostgreSQL queries and added automated tests for billing services."},
                {"id": "docs-work", "text": "Wrote API documentation and reviewed changes with a team of 4 developers."},
            ]},
            {"id": "role-two", "fields": {"title": "Software Developer", "company": "Fictional Harbor Studio",
             "location": "Ottawa", "date_range": "2018 - 2021"}, "bullets": [
                {"id": "report-work", "text": "Built Python reporting tools used by an internal operations team."},
                {"id": "support-work", "text": "Maintained scheduled data imports and documented support procedures."},
            ]},
         ]},
        {"id": "education", "kind": "education", "heading": "Education", "review_state": "reviewed",
         "entries": [{"id": "degree", "fields": {"qualification": "BSc Computer Science",
          "institution": "Fictional Lake College", "location": "Ottawa", "date_range": "2018"}}]},
        {"id": "certifications", "kind": "certifications", "heading": "Certifications", "review_state": "reviewed",
         "entries": [{"id": "certificate", "fields": {"name": "Secure Coding Workshop",
          "issuer": "Fictional Learning Guild", "date": "2023"}}]},
        {"id": "skills", "kind": "skills", "heading": "Skills", "review_state": "reviewed",
         "content_md": "Python, FastAPI, PostgreSQL, REST APIs, automated testing, API documentation."},
        {"id": "projects", "kind": "projects", "heading": "Projects", "review_state": "reviewed",
         "entries": [{"id": "library-project", "fields": {"name": "Community Library Catalog"}, "bullets": [
            {"id": "project-api", "text": "Built a volunteer Python catalog API with PostgreSQL and automated tests."},
         ]}]},
        {"id": "volunteering", "kind": "custom", "heading": "Volunteer Work", "review_state": "reviewed",
         "content_md": "Maintained Python tools and wrote setup documentation for a fictional community library."},
        {"id": "private-note", "kind": "custom", "heading": "Private Draft Notes", "enabled": False,
         "review_state": "reviewed", "content_md": "Morgan Synthetic, morgan.synthetic@example.test, 72 Fictional Lane."},
    ]}).model_dump(mode="json")


def current_document() -> dict[str, Any]:
    current = deepcopy(source_document())
    current["revision"] = 10
    current["sections"][0]["content_md"] = "I keep this manually edited summary exactly as written."
    current["sections"][1]["heading"] = "Relevant Experience"
    current["sections"][1]["entries"][0]["bullets"][0]["text"] = "Reduced Python API p95 request latency by 35%."
    current["sections"][1]["entries"][0]["bullets"][1]["text"] = "Optimized database queries and added automated tests."
    current["sections"][1]["entries"][0]["bullets"][2]["text"] = "My unrelated manual wording stays here."
    current["sections"][1]["entries"].reverse()
    current["sections"][1]["entries"].append({"id": "manual-role", "fields": {
        "title": "User-added role", "company": "Fictional Local Organization", "date_range": "2025"},
        "bullets": [{"id": "manual-bullet", "text": "An unrelated manual entry stays unchanged.", "source_ids": []}]})
    current["sections"].insert(0, {"id": "manual-custom", "kind": "custom", "heading": "User Notes",
        "review_state": "reviewed", "content_md": "An unrelated user-added section stays unchanged."})
    return validate_resume_document(current).model_dump(mode="json")


@dataclass(frozen=True)
class Case:
    id: str
    operation: str = "generation"
    aggressiveness: str = "medium"
    fault: str | None = None
    description: str = ""


CASES = [
    Case("full_low", aggressiveness="low", description="Full generation with source-exact titles and fixed sections."),
    Case("full_high", aggressiveness="high", description="Full generation with unsupported job requirements as factual traps."),
    Case("entry_preservation", "regeneration_section", description="Regenerate one role while preserving reordered and added siblings."),
    Case("keyword_preservation", "keyword_optimization", description="Add truthful missing keywords without overwriting manual edits."),
    Case("schema_recovery", fault="schema", description="Offline only: malformed envelope triggers Pydantic AI correction."),
    Case("metric_recovery", fault="metric", description="Offline only: wrong metric repairs only the failed section."),
    Case("audit_recovery", fault="audit", description="Offline only: semantic audit rejects invented technology and targets repair."),
]


def case_settings(case: Case) -> dict[str, Any]:
    source = source_document()
    settings: dict[str, Any] = {"aggressiveness": case.aggressiveness, "page_length": "1_page",
        "_operation": case.operation, "_privacy_values": list(PRIVACY_VALUES),
        "_source_snapshot": {"base_resume_id": "synthetic-base", "revision": source["revision"],
            "document": deepcopy(source), "content_md": render_resume_document(validate_resume_document(source), include_disabled=True)}}
    if case.operation != "generation":
        settings["_current_document"] = current_document()
    if case.operation == "regeneration_section":
        settings["_target_entry_id"] = "role-one"
    if case.operation == "keyword_optimization":
        settings["keyword_optimization"] = {"enabled": True, "target_keywords": ["billing services", "Kubernetes"],
            "preserve_keywords": ["Python", "FastAPI", "REST APIs", "PostgreSQL", "automated tests"]}
    return settings


def offline_writer(payload: dict[str, Any]) -> dict[str, Any]:
    if payload["operation"] == "keyword_optimization":
        return {"sections": [{"id": "experience", "paragraph": None, "source_ids": [], "entries": [
            {"id": "role-one", "bullets": [{"id": "query-work", "text":
                "Optimized database queries and added automated tests for billing services.", "source_ids": ["query-work"]}]},
        ]}]}
    sections = []
    for source in payload["requested_sections"]:
        entries = [{"id": entry["id"], "title": entry["fields"].get("title"),
            "bullets": [{"text": bullet["text"], "source_ids": [bullet["id"]]} for bullet in entry["bullets"]]}
            for entry in source["entries"]]
        sections.append({"id": source["id"], "paragraph": source["content_md"] if not entries else "",
            "source_ids": [source["id"]] if not entries else [], "entries": entries})
    return {"sections": sections}
