from pathlib import Path

import pytest
from pydantic import ValidationError

from app.services.resume_document import document_ready, parse_resume_document, render_resume_document, validate_resume_document


SOURCE = """# Jordan Example
jordan@example.com

## Professional Experience
Acme | Toronto, ON
Engineer | 2020 - 2024
- Built APIs.
- Reduced latency by 20%.

## Community Work
Volunteered at a food bank.
"""


def test_local_adapter_preserves_unknown_sections_and_stable_nested_identities():
    first = parse_resume_document(SOURCE, reviewed=True)
    again = parse_resume_document(SOURCE, reviewed=True)
    assert first.model_dump() == again.model_dump()
    assert [s.kind for s in first.sections] == ["professional_experience", "custom"]
    assert first.sections[0].entries[0].fields["company"] == "Acme"
    assert "jordan@example.com" not in render_resume_document(first)
    edited = parse_resume_document(SOURCE.replace("Built APIs.", "Built reliable APIs."), reviewed=True, previous=first)
    assert edited.sections[0].id == first.sections[0].id
    assert edited.sections[0].entries[0].id == first.sections[0].entries[0].id
    assert edited.sections[0].entries[0].bullets[1].id == first.sections[0].entries[0].bullets[1].id


def test_disabled_source_is_recoverable_without_entering_generation_projection():
    document = parse_resume_document(SOURCE)
    assert not document_ready(document)
    for section in document.sections:
        section.review_state = "reviewed"
    assert document_ready(document)
    document.sections[1].enabled = False
    assert "food bank" not in render_resume_document(document)
    assert "food bank" in render_resume_document(document, include_disabled=True)


def test_repeated_company_and_dates_do_not_duplicate_entry_ids():
    source = "## Professional Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n\nAcme\nEngineer | 2020 - 2024\n- Built queues.\n"
    document = parse_resume_document(source, reviewed=True)
    reparsed = parse_resume_document(source, reviewed=True, previous=document)
    validate_resume_document(reparsed.model_dump())
    assert len({entry.id for entry in reparsed.sections[0].entries}) == 2


def test_document_rejects_duplicate_ids_and_contact_section():
    document = parse_resume_document(SOURCE, reviewed=True).model_dump()
    document["sections"][1]["id"] = document["sections"][0]["id"]
    with pytest.raises(ValidationError, match="unique"):
        validate_resume_document(document)


def test_identical_source_bullets_keep_distinct_ids_after_an_edit():
    source = "## Professional Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n- Built APIs.\n"
    document = parse_resume_document(source, reviewed=True)
    updated = parse_resume_document(source.replace("2024", "2025"), reviewed=True, previous=document)
    validate_resume_document(updated.model_dump())
    assert len({b.id for b in updated.sections[0].entries[0].bullets}) == 2


def test_prepend_job_does_not_reuse_a_retained_entry_identity():
    old = parse_resume_document("## Professional Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n", reviewed=True)
    source = "## Professional Experience\nNewco\nEngineer | 2024 - Present\n- Built queues.\n\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n"
    updated = parse_resume_document(source, reviewed=True, previous=old)
    validate_resume_document(updated.model_dump())
    assert updated.sections[0].entries[1].id == old.sections[0].entries[0].id
    assert updated.sections[0].entries[0].id != updated.sections[0].entries[1].id


def test_inserted_bullet_preserves_existing_fact_identities():
    source = "## Professional Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n- Built queues.\n"
    old = parse_resume_document(source, reviewed=True)
    updated = parse_resume_document(source.replace("- Built APIs.", "- Added monitoring.\n- Built APIs."), reviewed=True, previous=old)
    validate_resume_document(updated.model_dump())
    assert [bullet.id for bullet in updated.sections[0].entries[0].bullets[1:]] == [bullet.id for bullet in old.sections[0].entries[0].bullets]


def test_new_heading_cannot_collide_with_an_explicitly_renamed_section():
    old = parse_resume_document("## Summary\nBuilt APIs.\n", reviewed=True)
    old.sections[0].heading = "Highlights"
    updated = parse_resume_document("## Highlights\nBuilt APIs.\n\n## Summary\nEngineer.\n", reviewed=True, previous=old)
    validate_resume_document(updated.model_dump())
    assert updated.sections[0].id == old.sections[0].id
    assert updated.sections[1].id != old.sections[0].id


def test_custom_entry_fields_are_preserved_in_the_markdown_projection():
    document = {"sections": [{"id": "research", "kind": "custom", "heading": "Research", "entries": [{"id": "paper", "fields": {"name": "A paper", "publication": "Example Journal", "contribution": "Built\nthe study"}, "bullets": []}]}]}
    rendered = render_resume_document(document)
    assert "- Publication: Example Journal" in rendered
    assert "- Contribution: Built\n  the study" in rendered


def test_reviewed_entries_require_identity_facts_but_dates_are_optional():
    document = validate_resume_document({"sections": [{"id": "experience", "kind": "professional_experience", "heading": "Professional Experience", "review_state": "reviewed", "entries": [{"id": "job", "fields": {"company": "Acme", "title": ""}, "bullets": [{"id": "fact", "text": "Built APIs."}]}]}]})
    assert not document_ready(document)
    document.sections[0].entries[0].fields["title"] = "Engineer"
    assert document_ready(document)


def test_identifiers_reject_contact_strings_and_diagnostics_hide_content():
    with pytest.raises(ValidationError) as captured:
        validate_resume_document({"sections": [{"id": "private@example.com", "kind": "custom", "heading": "Facts", "content_md": "Private text"}]})
    assert "private@example.com" not in str(captured.value)
    assert "Private text" not in str(captured.value)
    document = parse_resume_document(SOURCE, reviewed=True).model_dump()
    document["sections"][0]["heading"] = "Contact Information"
    with pytest.raises(ValidationError, match="profile"):
        validate_resume_document(document)


def test_separately_deployed_document_contracts_match():
    backend = Path(__file__).resolve().parents[1] / "app/services/resume_document.py"
    worker = Path(__file__).resolve().parents[2] / "agents/resume_document.py"
    assert backend.read_bytes() == worker.read_bytes()

@pytest.mark.parametrize('separator', ['', '\n', '\n\n'])
@pytest.mark.parametrize('header_style', ['rows', 'single', 'reverse'])
def test_adjacent_roles_have_separate_facts_and_bullets_without_pdf_spacing(separator, header_style):
    headers = {
        'rows': ('Acme | Toronto\nEngineer | 2022 - Present', 'Beta | Remote\nDeveloper | 2019 - 2022'),
        'single': ('Engineer | Acme | 2022 - Present', 'Developer | Beta | 2019 - 2022'),
        'reverse': ('Engineer | 2022 - Present\nAcme | Toronto', 'Developer | 2019 - 2022\nBeta | Remote'),
    }[header_style]
    body = headers[0] + '\n- Built APIs.\n  Kept them reliable.\n' + separator + headers[1] + '\n- Built C++ tools with +20.5% improvement.'
    document = parse_resume_document('## Experience\n' + body)
    section = document.sections[0]
    assert section.content_md == body
    assert [entry.fields['company'] for entry in section.entries] == ['Acme', 'Beta']
    assert [entry.fields['date_range'] for entry in section.entries] == ['2022 - Present', '2019 - 2022']
    assert [entry.bullets[0].text for entry in section.entries] == ['Built APIs.\nKept them reliable.', 'Built C++ tools with +20.5% improvement.']
    assert section.review_state == 'needs_review'
    reparsed = parse_resume_document('## Experience\n' + body, previous=document)
    assert reparsed.model_dump() == document.model_dump()
    validate_resume_document(document.model_dump())


def test_unsupported_later_role_headers_preserve_the_entire_source_for_review():
    body = 'Acme\nEngineer | 2022 - Present\n- Built APIs.\nBeta\nDeveloper\n2019 - 2022\n- Built tools.'
    section = parse_resume_document('## Experience\n' + body).sections[0]
    assert section.entries == []
    assert section.content_md == body
    assert section.review_state == 'needs_review'


def test_blank_lines_in_wrapped_bullets_do_not_erase_jobs():
    body = 'Acme\nEngineer | 2022 - Present\n\n- Built APIs.\n\n- Maintained systems in 2020 and 2021.\n  Continued supporting them.'
    section = parse_resume_document('## Experience\n' + body).sections[0]
    assert len(section.entries) == 1
    assert [b.text for b in section.entries[0].bullets] == ['Built APIs.', 'Maintained systems in 2020 and 2021.\nContinued supporting them.']
