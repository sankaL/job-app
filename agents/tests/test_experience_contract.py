from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from experience_contract import (
    extract_professional_experience_anchors,
    normalize_professional_experience_section,
    validate_professional_experience_contract,
)
from validation import validate_resume


SOURCE_EXPERIENCE = """## Professional Experience
Backend Engineer | Acme Corp | 2021 - Present
- Built backend APIs.

Software Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""


def _anchors() -> list[dict[str, object]]:
    return extract_professional_experience_anchors(SOURCE_EXPERIENCE)


def test_extract_professional_experience_anchors_keeps_role_order_and_source_fields():
    anchors = _anchors()

    assert anchors == [
        {
            "role_index": 0,
            "source_title": "Backend Engineer",
            "source_company": "Acme Corp",
            "source_date_range": "2021 - Present",
        },
        {
            "role_index": 1,
            "source_title": "Software Engineer",
            "source_company": "Beta Labs",
            "source_date_range": "2018 - 2021",
        },
    ]


def test_normalize_professional_experience_section_low_restores_title_company_and_dates():
    anchors = _anchors()
    generated = """## Professional Experience
Platform Engineer | Wrong Co | 2020 - Present
- Built backend APIs.

Lead Engineer | Different Co | 2017 - 2020
- Shipped production features.
"""

    normalized, issues = normalize_professional_experience_section(
        section_markdown=generated,
        anchors=anchors,
        aggressiveness="low",
    )

    assert issues == []
    assert "Backend Engineer | Acme Corp | 2021 - Present" in normalized
    assert "Software Engineer | Beta Labs | 2018 - 2021" in normalized
    assert "- Built backend APIs." in normalized
    assert "- Shipped production features." in normalized


def test_normalize_professional_experience_section_high_keeps_generated_titles_but_restores_company_and_dates():
    anchors = _anchors()
    generated = """## Professional Experience
Platform Engineer | Wrong Co | 2020 - Present
- Built backend APIs.

Lead Engineer | Different Co | 2017 - 2020
- Shipped production features.
"""

    normalized, issues = normalize_professional_experience_section(
        section_markdown=generated,
        anchors=anchors,
        aggressiveness="high",
    )

    assert issues == []
    assert "Platform Engineer | Acme Corp | 2021 - Present" in normalized
    assert "Lead Engineer | Beta Labs | 2018 - 2021" in normalized


def test_normalize_professional_experience_section_medium_keeps_generated_titles_but_restores_company_and_dates():
    anchors = _anchors()
    generated = """## Professional Experience
Platform Engineer | Acme Corp | 2021 - Present
- Built backend APIs.

Application Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""

    normalized, issues = normalize_professional_experience_section(
        section_markdown=generated,
        anchors=anchors,
        aggressiveness="medium",
    )

    assert issues == []
    assert "Platform Engineer | Acme Corp | 2021 - Present" in normalized
    assert "Application Engineer | Beta Labs | 2018 - 2021" in normalized


def test_validate_professional_experience_contract_allows_grounded_title_rewrite_for_medium():
    anchors = _anchors()
    section = """## Professional Experience
Platform Engineer | Acme Corp | 2021 - Present
- Built backend APIs.

Application Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""

    errors = validate_professional_experience_contract(
        section_markdown=section,
        anchors=anchors,
        aggressiveness="medium",
    )

    assert errors == []


def test_validate_professional_experience_contract_allows_title_rewrite_for_high():
    anchors = _anchors()
    section = """## Professional Experience
Platform Engineer | Acme Corp | 2021 - Present
- Built backend APIs.

Software Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""

    errors = validate_professional_experience_contract(
        section_markdown=section,
        anchors=anchors,
        aggressiveness="high",
    )

    assert errors == []


def test_validate_professional_experience_contract_rejects_ungrounded_title_rewrite_for_medium():
    anchors = _anchors()
    section = """## Professional Experience
Engagement Lead | Acme Corp | 2021 - Present
- Built backend APIs.

Software Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""

    errors = validate_professional_experience_contract(
        section_markdown=section,
        anchors=anchors,
        aggressiveness="medium",
    )

    assert any("must stay grounded in the source title" in error for error in errors)


def test_validate_professional_experience_contract_rejects_seniority_change_for_high():
    anchors = _anchors()
    section = """## Professional Experience
Senior Platform Engineer | Acme Corp | 2021 - Present
- Built backend APIs.

Software Engineer | Beta Labs | 2018 - 2021
- Shipped production features.
"""

    errors = validate_professional_experience_contract(
        section_markdown=section,
        anchors=anchors,
        aggressiveness="high",
    )

    assert any("must preserve source seniority" in error for error in errors)


def test_validate_professional_experience_contract_fails_when_role_blocks_are_missing():
    anchors = _anchors()
    section = """## Professional Experience
Backend Engineer | Acme Corp | 2021 - Present
- Built backend APIs.
"""

    errors = validate_professional_experience_contract(
        section_markdown=section,
        anchors=anchors,
        aggressiveness="low",
    )

    assert any("same number of role blocks" in error for error in errors)


@pytest.mark.asyncio
async def test_validate_resume_fails_when_professional_experience_contract_is_unrecoverable():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": "## Professional Experience\nBackend Engineer | Acme Corp | 2021 - Present\n- Built backend APIs.",
                "supporting_snippets": ["Built backend APIs.", "Acme Corp"],
            }
        ],
        base_resume_content=SOURCE_EXPERIENCE,
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=_anchors(),
    )

    assert result["valid"] is False
    assert any(error["type"] == "experience_structure_violation" for error in result["errors"])
