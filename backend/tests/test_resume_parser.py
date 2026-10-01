from __future__ import annotations

import time

import pytest

from app.services.resume_parser import (
    CleanupOutput,
    NestedExtractionOutput,
    PdfParseTimeoutError,
    ResumeParserService,
    _validate_cleanup_payload,
    parse_pdf_with_timeout,
)


def _slow_pdf_process(_file_bytes, _result_queue) -> None:
    time.sleep(5)


def _large_pdf_process(_file_bytes, result_queue) -> None:
    result_queue.put(("ok", "source words " * 15000))


def test_pdf_parser_subprocess_is_terminated_at_deadline():
    with pytest.raises(PdfParseTimeoutError, match="time limit"):
        parse_pdf_with_timeout(b"%PDF-1.7", timeout_seconds=0.05, _process_target=_slow_pdf_process)


def test_pdf_parser_drains_large_results_before_joining_subprocess():
    result = parse_pdf_with_timeout(b"%PDF-1.7", timeout_seconds=3.0, _process_target=_large_pdf_process)
    assert result == "source words " * 15000


@pytest.mark.asyncio
async def test_cleanup_sanitizes_provider_input_and_keeps_contact_local(monkeypatch):
    captured = {}

    async def invoke(**kwargs):
        captured.update(kwargs)
        result = CleanupOutput(cleaned_markdown="## Summary\nBuilt backend systems.\n", needs_review=False, review_reason=None)
        kwargs["validator"](result)
        return result

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n## Summary\nBuilt backend systems.\n"
    )
    assert captured["user_prompt"] == "## Summary\nBuilt backend systems.\n"
    assert cleaned.cleaned_markdown.startswith("Alex Example\nalex@example.com")
    assert cleaned.needs_review is False
    assert captured["timeout_seconds"] == 30.0


@pytest.mark.asyncio
async def test_cleanup_preserves_project_urls_in_provider_input(monkeypatch):
    captured = {}

    async def invoke(**kwargs):
        captured.update(kwargs)
        return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n## Projects\n- Demo: https://github.com/acme/tool\n"
    )
    assert "github.com/acme/tool" in captured["user_prompt"]
    assert "linkedin.com" not in captured["user_prompt"]
    assert "github.com/acme/tool" in cleaned.cleaned_markdown


@pytest.mark.asyncio
async def test_cleanup_rejects_changed_facts_and_preserves_original(monkeypatch):
    async def invoke(**_kwargs):
        return CleanupOutput(cleaned_markdown="## Summary\nBuilt Fortune 500 backend systems.\n", needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "## Summary\nBuilt backend systems.\n"
    result = await ResumeParserService(openrouter_api_key="test-key").cleanup_with_llm(source)
    assert result.cleaned_markdown == source
    assert result.needs_review is True
    assert "original text was preserved" in result.review_reason


@pytest.mark.asyncio
@pytest.mark.parametrize(("source_fact", "changed_fact"), [
    ("Built C++ APIs.", "Built C# APIs."),
    ("Built .NET APIs.", "Built NET APIs."),
    ("Improved uptime 35%.", "Improved uptime 35."),
    ("Improved revenue +35.5%.", "Improved revenue -35.5%."),
    ("Improved revenue +.5%.", "Improved revenue -.5%."),
    ("Latency changed −35%.", "Latency changed 35%."),
    ("Saved $500.", "Saved €500."),
])
async def test_cleanup_cannot_change_technology_or_numeric_punctuation(monkeypatch, source_fact, changed_fact):
    async def invoke(**_kwargs):
        return CleanupOutput(cleaned_markdown="## Summary\n" + changed_fact, needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "## Summary\n" + source_fact
    result = await ResumeParserService(openrouter_api_key="test-key").cleanup_with_llm(source)
    assert result.cleaned_markdown == source
    assert result.needs_review


@pytest.mark.asyncio
async def test_cleanup_allows_markdown_formatting_without_changing_facts(monkeypatch):
    async def invoke(**_kwargs):
        return CleanupOutput(cleaned_markdown="## Summary\n- Built **C++** and **.NET** APIs with 35%.\n", needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "## Summary\nBuilt C++ and .NET APIs with 35 %.\n"
    result = await ResumeParserService(openrouter_api_key="test-key").cleanup_with_llm(source)
    assert "**C++**" in result.cleaned_markdown
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_cleanup_allows_date_separator_spacing(monkeypatch):
    async def invoke(**_kwargs):
        return CleanupOutput(cleaned_markdown="## Experience\nAcme | Engineer | 2020 - 2024\n- Built APIs.", needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "## Experience\nAcme | Engineer | 2020-2024\n- Built APIs."
    result = await ResumeParserService(openrouter_api_key="test-key").cleanup_with_llm(source)
    assert "2020 - 2024" in result.cleaned_markdown
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_cleanup_failure_is_visible_and_source_is_recoverable(monkeypatch):
    async def invoke(**_kwargs):
        raise TimeoutError("Provider details must not reach the user")

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "## Summary\nBuilt backend systems.\n"
    result = await ResumeParserService(openrouter_api_key="test-key").cleanup_with_llm(source)
    assert result.cleaned_markdown == source
    assert result.needs_review is True
    assert "Provider details" not in result.review_reason


@pytest.mark.asyncio
async def test_missing_provider_configuration_requires_review():
    source = "## Summary\nBuilt backend systems.\n"
    result = await ResumeParserService().cleanup_with_llm(source)
    assert result.cleaned_markdown == source
    assert result.needs_review
    assert "unavailable" in result.review_reason


@pytest.mark.asyncio
async def test_import_keeps_unknown_sections_and_requires_explicit_review():
    result = await ResumeParserService().import_resume(
        "Alex Example\nalex@example.com\n\n## Volunteer Work\n- Coached a youth team.\n"
    )
    section = result.document["sections"][0]
    assert section["kind"] == "custom"
    assert section["heading"] == "Volunteer Work"
    assert section["content_md"] == "- Coached a youth team."
    assert section["review_state"] == "needs_review"
    assert "alex@example.com" not in str(result.document)
    assert "Alex Example" not in str(result.document)


@pytest.mark.asyncio
async def test_unknown_heading_is_a_safe_body_boundary_without_blank_lines():
    result = await ResumeParserService().import_resume("Alex Example\nalex@example.com\n## Community Service\nCoached a youth team.")
    assert result.document["sections"][0]["content_md"] == "Coached a youth team."
    assert result.contact_suggestions["name"] == "Alex Example"
    assert result.contact_suggestions["email"] == "alex@example.com"


@pytest.mark.asyncio
@pytest.mark.parametrize("contact_heading", ["Contact", "Contact Details", "Personal Details", "Personal Info", "Contacts"])
async def test_contact_section_is_kept_local_and_saved_as_advisory_suggestions(monkeypatch, contact_heading):
    captured = []

    async def invoke(**kwargs):
        captured.append(kwargs["user_prompt"])
        return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    result = await ResumeParserService(openrouter_api_key="test-key", classifier="local").import_resume(
        "## " + contact_heading + "\nAlex Example\nalex@example.com\n+1 416 555 0100\n123 King Street\nhttps://linkedin.com/in/alex\n## Skills\nPython, SQL", use_llm_cleanup=True
    )
    assert result.contact_suggestions == {"name": "Alex Example", "email": "alex@example.com", "phone": "+1 416 555 0100", "address": "123 King Street", "linkedin": "https://linkedin.com/in/alex"}
    assert captured == []  # Locally structured content needs no generative cleanup.
    assert "Alex Example" not in str(result.document)


@pytest.mark.asyncio
async def test_unheaded_import_preserves_unknown_facts_and_avoids_external_calls(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("Unclear section boundaries must stay local.")

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", fail_if_called)
    result = await ResumeParserService(openrouter_api_key="test-key").import_resume(
        "Alex Example\nalex@example.com\nBuilt APIs for volunteer projects.\nPython, SQL", use_llm_cleanup=True
    )
    assert result.document["sections"][0]["content_md"] == "Built APIs for volunteer projects.\nPython, SQL"
    assert "identify the sections" in result.warning


@pytest.mark.asyncio
async def test_jev_labels_are_advisory_and_no_contact_leaves_machine(monkeypatch):
    from app.services.resume_classifier import KINDS, SectionClassification
    captured = {}

    async def classify(blocks, **kwargs):
        captured.update(blocks=blocks, kwargs=kwargs)
        return {
            key: SectionClassification(type="choice", choice="professional_experience", confidence=0.98,
                probabilities={kind: 1.0 if kind == "professional_experience" else 0.0 for kind in KINDS})
            for key in blocks
        }

    monkeypatch.setattr("app.services.resume_parser.classify_resume_sections", classify)
    result = await ResumeParserService(openrouter_api_key="test-key", classifier="jev").import_resume(
        "Alex Example\nalex@example.com | +1 416 555 0100\n\n## Career Chronicle\nAcme | Toronto\nEngineer | 2020 - 2024\n- Built APIs."
    )
    section = result.document["sections"][0]
    assert section["kind"] == "professional_experience"
    assert section["confidence"] == 0.98
    assert section["review_state"] == "needs_review"
    assert section["entries"][0]["fields"]["company"] == "Acme"
    assert "Alex Example" not in str(captured["blocks"])
    assert "alex@example.com" not in str(captured["blocks"])
    assert "416" not in str(captured["blocks"])


@pytest.mark.asyncio
async def test_jev_failure_keeps_source_and_surfaces_warning(monkeypatch):
    async def classify(*_args, **_kwargs):
        raise ValueError("secret raw provider result")

    monkeypatch.setattr("app.services.resume_parser.classify_resume_sections", classify)
    result = await ResumeParserService(openrouter_api_key="test-key", classifier="jev").import_resume("## Skills\nPython, FastAPI")
    assert result.document["sections"][0]["content_md"] == "Python, FastAPI"
    assert result.document["sections"][0]["review_state"] == "needs_review"
    assert "classification did not finish" in result.warning
    assert "secret" not in result.warning


@pytest.mark.asyncio
async def test_nested_extraction_accepts_only_complete_exact_source_entries(monkeypatch):
    async def invoke(**kwargs):
        if kwargs["output_type"] is CleanupOutput:
            return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)
        import json
        payload = json.loads(kwargs["user_prompt"])
        result = NestedExtractionOutput(sections=[{
            "section_id": payload["sections"][0]["section_id"],
            "entries": [{"source_start_line": 1, "source_end_line": 4, "fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": [{"source_start_line": 4, "source_end_line": 4}]}],
        }])
        kwargs["validator"](result)
        return result

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    result = await ResumeParserService(openrouter_api_key="test-key").import_resume(
        "## Experience\nAcme\nEngineer\n2020 - 2024\n- Built APIs.", use_llm_cleanup=True
    )
    entry = result.document["sections"][0]["entries"][0]
    assert entry["fields"]["company"] == "Acme"
    assert entry["bullets"][0]["text"] == "Built APIs."
    assert result.document["sections"][0]["review_state"] == "needs_review"


@pytest.mark.asyncio
async def test_nested_extraction_cannot_omit_unparsed_source_words(monkeypatch):
    async def invoke(**kwargs):
        if kwargs["output_type"] is CleanupOutput:
            return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)
        import json
        payload = json.loads(kwargs["user_prompt"])
        return NestedExtractionOutput(sections=[{
            "section_id": payload["sections"][0]["section_id"],
            "entries": [{"source_start_line": 1, "source_end_line": 4, "fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": []}],
        }])

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "Acme\nEngineer\n2020 - 2024\n- Built APIs."
    result = await ResumeParserService(openrouter_api_key="test-key").import_resume("## Experience\n" + source, use_llm_cleanup=True)
    section = result.document["sections"][0]
    assert section["entries"] == []
    assert section["content_md"] == source
    assert "could not be structured safely" in result.warning


@pytest.mark.asyncio
@pytest.mark.parametrize(("source_fact", "truncated_fact"), [
    ("Built C++", "Built C"),
    ("Improved uptime 35%", "Improved uptime 35"),
])
async def test_nested_extraction_cannot_replace_source_bullet_text(monkeypatch, source_fact, truncated_fact):
    async def invoke(**kwargs):
        if kwargs["output_type"] is CleanupOutput:
            return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)
        import json
        payload = json.loads(kwargs["user_prompt"])
        return NestedExtractionOutput(sections=[{
            "section_id": payload["sections"][0]["section_id"],
            "entries": [{"source_start_line": 1, "source_end_line": 4, "fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": [truncated_fact]}],
        }])

    monkeypatch.setattr("app.services.resume_parser.invoke_import_output", invoke)
    source = "Acme\nEngineer\n2020 - 2024\n- " + source_fact
    result = await ResumeParserService(openrouter_api_key="test-key").import_resume("## Experience\n" + source, use_llm_cleanup=True)
    section = result.document["sections"][0]
    assert section["entries"] == []
    assert section["content_md"] == source
    assert "could not be structured safely" in result.warning


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"cleaned_markdown": "## Summary\nBuilt backend systems.\n", "needs_review": False, "review_reason": None, "extra": "not allowed"}, "exactly cleaned_markdown"),
        ({"cleaned_markdown": "", "needs_review": False, "review_reason": None}, "non-empty string"),
        ({"cleaned_markdown": "## Summary\nBuilt backend systems.\n", "needs_review": "false", "review_reason": None}, "needs_review must be a boolean"),
        ({"cleaned_markdown": "## Summary\nBuilt backend systems.\n", "needs_review": True, "review_reason": None}, "review_reason is required"),
    ],
)
def test_validate_cleanup_payload_rejects_malformed_contracts(payload, message):
    with pytest.raises(ValueError, match=message):
        _validate_cleanup_payload(payload)


@pytest.mark.asyncio
async def test_jev_reclassification_keeps_nested_ids_unique_across_sections(monkeypatch):
    from app.services.resume_classifier import KINDS, SectionClassification
    from app.services.resume_document import validate_resume_document

    async def classify(blocks, **_kwargs):
        return {identifier: SectionClassification(type="choice", choice="professional_experience", confidence=0.99, probabilities={kind: 1.0 if kind == "professional_experience" else 0.0 for kind in KINDS}) for identifier in blocks}

    monkeypatch.setattr("app.services.resume_parser.classify_resume_sections", classify)
    source = "## Professional Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n\n## Internships\nBeta\nIntern | 2019 - 2020\n- Built tests.\n\n## Earlier Work\nGamma\nDeveloper | 2017 - 2019\n- Built tools."
    parser = ResumeParserService(openrouter_api_key="test-key", classifier="jev")
    first = await parser.import_resume(source, use_llm_cleanup=False)
    second = await parser.import_resume(source, use_llm_cleanup=False)
    parsed = validate_resume_document(first.document)
    assert [section.kind for section in parsed.sections] == ["professional_experience"] * 3
    assert len({entry.id for section in parsed.sections for entry in section.entries}) == 3
    assert len({bullet.id for section in parsed.sections for entry in section.entries for bullet in entry.bullets}) == 3
    assert first.document == second.document
    assert first.warning is None

@pytest.mark.asyncio
async def test_multi_job_import_supports_explicit_local_only_mode(monkeypatch):
    async def unexpected(**_kwargs):
        raise AssertionError('Recognizable headers should need no generative call.')
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', unexpected)
    body = 'Acme | Toronto\nEngineer | 2022 - Present\n- Built APIs.\nBeta | Remote\nDeveloper | 2019 - 2022\n- Built C++ tools.'
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=False)
    section = result.document['sections'][0]
    assert [entry['fields']['company'] for entry in section['entries']] == ['Acme', 'Beta']
    assert section['review_state'] == 'needs_review'
    assert section['content_md'] == body


@pytest.mark.asyncio
async def test_suspicious_single_entry_is_eligible_for_nested_extraction_and_safe_fallback(monkeypatch):
    from app.services.resume_document import parse_resume_document
    body = 'Acme\nEngineer | 2022 - Present\n- Built APIs.\nBeta\nDeveloper\n2019 - 2022\n- Built tools.'
    partial = parse_resume_document('## Experience\nAcme\nEngineer | 2022 - Present\n- Built APIs.')
    partial.sections[0].content_md = body
    partial.sections[0].entries[0].bullets[0].text += '\nBeta\nDeveloper\n2019 - 2022\nBuilt tools.'
    monkeypatch.setattr('app.services.resume_parser.parse_resume_document', lambda *args, **kwargs: partial.model_copy(deep=True))
    calls = []
    async def unavailable(**kwargs):
        calls.append(kwargs['model'])
        raise RuntimeError('private provider detail')
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', unavailable)
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
    assert len(calls) == 2
    assert result.document['sections'][0]['entries'] == []
    assert result.document['sections'][0]['content_md'] == body
    assert result.document['sections'][0]['review_state'] == 'needs_review'
    assert 'could not be structured safely' in result.warning
    assert 'private' not in result.warning


@pytest.mark.asyncio
async def test_nested_extraction_rejects_merged_jobs_even_when_all_words_are_retained(monkeypatch):
    import json
    body = 'Acme\nEngineer\n2022 - Present\n- Built APIs.\nBeta\nDeveloper\n2019 - 2022\n- Built tools.'
    async def merged(**kwargs):
        section_id = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        return NestedExtractionOutput(sections=[{'section_id': section_id, 'entries': [{'source_start_line': 1, 'source_end_line': 8, 'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': [{'source_start_line': 4, 'source_end_line': 8}]}]}])
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', merged)
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
    assert result.document['sections'][0]['entries'] == []
    assert result.document['sections'][0]['content_md'] == body
    assert 'could not be structured safely' in result.warning


@pytest.mark.asyncio
async def test_nested_extraction_keeps_each_opaque_job_separate(monkeypatch):
    import json
    body = 'Acme\nEngineer\n2022 - Present\n- Built APIs.\nBeta\nDeveloper\n2019 - 2022\n- Built tools.'
    async def extract(**kwargs):
        section_id = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        output = NestedExtractionOutput(sections=[{'section_id': section_id, 'entries': [
            {'source_start_line': 1, 'source_end_line': 4, 'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': [{'source_start_line': 4, 'source_end_line': 4}]},
            {'source_start_line': 5, 'source_end_line': 8, 'fields': {'company': 'Beta', 'title': 'Developer', 'date_range': '2019 - 2022'}, 'bullets': [{'source_start_line': 8, 'source_end_line': 8}]},
        ]}])
        kwargs['validator'](output)
        return output
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
    section = result.document['sections'][0]
    assert [entry['fields']['company'] for entry in section['entries']] == ['Acme', 'Beta']
    assert section['content_md'] == body
    assert section['review_state'] == 'needs_review'

@pytest.mark.asyncio
async def test_nested_extraction_rejects_reordered_job_dates_with_complete_word_coverage(monkeypatch):
    import json
    body = 'Acme\nEngineer\n2022 - Present\n- Built APIs.\nBeta\nDeveloper\n2019 - 2022\n- Built tools.'
    async def reversed_jobs(**kwargs):
        section_id = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        return NestedExtractionOutput(sections=[{'section_id': section_id, 'entries': [
            {'source_start_line': 5, 'source_end_line': 8, 'fields': {'company': 'Beta', 'title': 'Developer', 'date_range': '2019 - 2022'}, 'bullets': [{'source_start_line': 8, 'source_end_line': 8}]},
            {'source_start_line': 1, 'source_end_line': 4, 'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': [{'source_start_line': 4, 'source_end_line': 4}]},
        ]}])
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', reversed_jobs)
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
    assert result.document['sections'][0]['entries'] == []
    assert result.document['sections'][0]['content_md'] == body
    assert 'could not be structured safely' in result.warning


def _three_role_source():
    return (
        'Acme Canada Toronto, ON\n'
        'Manager, Quality Engineering Jan 2022 - Present\n'
        '- Managed 15+ engineers and built C++ tools with 35%\n'
        'less overhead across per-\n'
        'project workflows.\n'
        'Acme Canada Toronto, ON\n'
        'Senior Consultant, Quality Engineering Jan 2019 - Dec 2021\n'
        '- Led automation for analytics.\n'
        'Acme Canada Toronto, ON\n'
        'Consultant, Quality Engineering Jan 2016 - Dec 2018\n'
        '- Built Selenium suites.'
    )


def _three_role_output(section_id):
    return {'section_id': section_id, 'entries': [
        {'source_start_line': 1, 'source_end_line': 5,
         'fields': {'company': 'Acme Canada', 'location': 'Toronto, ON', 'title': 'Manager, Quality Engineering', 'date_range': 'Jan 2022 - Present'},
         'bullets': [{'source_start_line': 3, 'source_end_line': 5}]},
        {'source_start_line': 6, 'source_end_line': 8,
         'fields': {'company': 'Acme Canada', 'location': 'Toronto, ON', 'title': 'Senior Consultant, Quality Engineering', 'date_range': 'Jan 2019 - Dec 2021'},
         'bullets': [{'source_start_line': 8, 'source_end_line': 8}]},
        {'source_start_line': 9, 'source_end_line': 11,
         'fields': {'company': 'Acme Canada', 'location': 'Toronto, ON', 'title': 'Consultant, Quality Engineering', 'date_range': 'Jan 2016 - Dec 2018'},
         'bullets': [{'source_start_line': 11, 'source_end_line': 11}]},
    ]}


@pytest.mark.asyncio
async def test_default_import_extracts_repeated_employer_roles_and_copies_wrapped_duties(monkeypatch):
    import json
    calls = []

    async def extract(**kwargs):
        calls.append(kwargs)
        sections = json.loads(kwargs['user_prompt'])['sections']
        experience, education = sections
        assert [row['line'] for row in experience['source_lines']] == list(range(1, 12))
        assert 'alex@example.com' not in kwargs['user_prompt']
        result = NestedExtractionOutput(sections=[_three_role_output(experience['section_id']), {
            'section_id': education['section_id'], 'entries': [{
                'source_start_line': 1, 'source_end_line': 2,
                'fields': {'institution': 'Example University', 'qualification': 'Bachelor of Science', 'location': 'Toronto, ON', 'date_range': '2016'}, 'bullets': []
            }]
        }])
        kwargs['validator'](result)
        return result

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    source = 'Alex Example\nalex@example.com\n## Experience\n' + _three_role_source() + '\n## Education\nExample University Toronto, ON\nBachelor of Science 2016'
    parser = ResumeParserService(openrouter_api_key='test-only', classifier='local', openrouter_model='configured-tier2')
    result = await parser.import_resume(source)
    experience, education = result.document['sections']
    assert len(calls) == 1
    assert calls[0]['model'] == 'configured-tier2'
    assert result.warning is None
    assert [entry['fields']['title'] for entry in experience['entries']] == ['Manager, Quality Engineering', 'Senior Consultant, Quality Engineering', 'Consultant, Quality Engineering']
    assert experience['entries'][0]['bullets'][0]['text'] == 'Managed 15+ engineers and built C++ tools with 35% less overhead across per- project workflows.'
    assert education['entries'][0]['fields']['date_range'] == '2016'
    assert all(section['review_state'] == 'needs_review' for section in result.document['sections'])
    assert experience['content_md'] == _three_role_source()


@pytest.mark.asyncio
@pytest.mark.parametrize('damage', ['swapped_duties', 'swapped_titles', 'swapped_dates', 'overlap', 'gap', 'merged_headers', 'wrong_field_kind'])
async def test_nested_extraction_rejects_cross_role_facts_and_invalid_spans(monkeypatch, damage):
    import json
    from app.services.resume_document import ResumeSection
    section = ResumeSection(id='experience', kind='professional_experience', heading='Experience', content_md=_three_role_source())
    calls = []

    async def extract(**kwargs):
        calls.append(kwargs['model'])
        output = _three_role_output(json.loads(kwargs['user_prompt'])['sections'][0]['section_id'])
        first, second, third = output['entries']
        if damage == 'swapped_duties':
            first['bullets'], second['bullets'] = second['bullets'], first['bullets']
        elif damage == 'swapped_titles':
            first['fields']['title'], second['fields']['title'] = second['fields']['title'], first['fields']['title']
        elif damage == 'swapped_dates':
            first['fields']['date_range'], second['fields']['date_range'] = second['fields']['date_range'], first['fields']['date_range']
        elif damage == 'overlap':
            second['source_start_line'] = 5
        elif damage == 'gap':
            second['source_start_line'] = 7
        elif damage == 'merged_headers':
            first['source_end_line'] = 8
            first['bullets'] += [{'source_start_line': 6, 'source_end_line': 8}]
            output['entries'] = [first, third]
        else:
            first['fields'] = {'institution': 'Acme Canada', 'qualification': 'Manager, Quality Engineering', 'location': 'Toronto, ON', 'date_range': 'Jan 2022 - Present'}
        return NestedExtractionOutput(sections=[output])

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    with pytest.raises(ValueError):
        await ResumeParserService(openrouter_api_key='test-only')._extract_nested_entries([section], timeout_seconds=3)
    assert len(calls) == 2
    assert section.entries == []
    assert section.content_md == _three_role_source()


@pytest.mark.asyncio
async def test_ai_extraction_runs_for_locally_recognizable_roles_by_default(monkeypatch):
    import json
    calls = []

    async def extract(**kwargs):
        calls.append(kwargs['model'])
        identifier = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        return NestedExtractionOutput(sections=[{'section_id': identifier, 'entries': [{
            'source_start_line': 1, 'source_end_line': 3,
            'fields': {'company': 'Acme', 'title': 'Engineer', 'location': 'Toronto', 'date_range': '2022 - Present'},
            'bullets': [{'source_start_line': 3, 'source_end_line': 3}]
        }]}])

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    result = await ResumeParserService(openrouter_api_key='test-only', classifier='local').import_resume('## Experience\nAcme | Toronto\nEngineer | 2022 - Present\n- Built APIs.')
    assert len(calls) == 1
    assert result.warning is None
    assert result.document['sections'][0]['entries'][0]['fields']['company'] == 'Acme'


@pytest.mark.asyncio
async def test_missing_dates_remain_empty_without_inventing_an_employment_range(monkeypatch):
    import json

    async def extract(**kwargs):
        identifier = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        return NestedExtractionOutput(sections=[{'section_id': identifier, 'entries': [{
            'source_start_line': 1, 'source_end_line': 3,
            'fields': {'company': 'Acme', 'title': 'Engineer', 'location': '', 'date_range': ''},
            'bullets': [{'source_start_line': 3, 'source_end_line': 3}]
        }]}])

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    result = await ResumeParserService(openrouter_api_key='test-only', classifier='local').import_resume('## Experience\nAcme\nEngineer\n- Built APIs.')
    assert result.warning is None
    assert result.document['sections'][0]['entries'][0]['fields']['date_range'] == ''


@pytest.mark.asyncio
async def test_authentication_rejection_stops_import_fallback(monkeypatch):
    calls = []

    class Rejected(Exception):
        status_code = 401

    async def reject(**kwargs):
        calls.append(kwargs['model'])
        raise Rejected()

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', reject)
    result = await ResumeParserService(openrouter_api_key='test-only', classifier='local').import_resume('## Experience\nAcme\nEngineer\n- Built APIs.')
    assert len(calls) == 1
    assert result.document['sections'][0]['entries'] == []
    assert 'could not be structured safely' in result.warning


@pytest.mark.asyncio
async def test_distinct_duty_bullets_cannot_be_collapsed_by_source_references(monkeypatch):
    import json

    async def merged(**kwargs):
        identifier = json.loads(kwargs['user_prompt'])['sections'][0]['section_id']
        return NestedExtractionOutput(sections=[{'section_id': identifier, 'entries': [{
            'source_start_line': 1, 'source_end_line': 4,
            'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2020 - 2024'},
            'bullets': [{'source_start_line': 3, 'source_end_line': 4}]
        }]}])

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', merged)
    result = await ResumeParserService(openrouter_api_key='test-only', classifier='local').import_resume('## Experience\nAcme\nEngineer 2020 - 2024\n- Built APIs.\n- Built tools.')
    assert result.document['sections'][0]['entries'] == []
    assert result.warning


def test_timeout_local_import_discards_suspicious_partial_projection(monkeypatch):
    from app.services.resume_document import parse_resume_document
    partial = parse_resume_document('## Experience\nAcme\nEngineer | 2022 - Present\n- Built APIs.')
    partial.sections[0].content_md += '\nBeta\nDeveloper 2019 - 2022\n- Built tools.'
    monkeypatch.setattr('app.services.resume_parser.parse_resume_document', lambda *args, **kwargs: partial.model_copy(deep=True))
    result = ResumeParserService().local_import('## Experience\n' + partial.sections[0].content_md, warning='Import assistance timed out.')
    assert result.document['sections'][0]['entries'] == []
    assert result.document['sections'][0]['content_md'] == partial.sections[0].content_md
    assert result.warning == 'Import assistance timed out.'


@pytest.mark.asyncio
async def test_duplicate_model_configuration_attempts_only_one_invocation(monkeypatch):
    from app.services.resume_document import ResumeSection
    calls = []

    async def unavailable(**kwargs):
        calls.append(kwargs)
        raise RuntimeError('Provider unavailable')

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', unavailable)
    section = ResumeSection(id='experience', kind='professional_experience', heading='Experience', content_md='Acme\nEngineer\n- Built APIs.')
    with pytest.raises(RuntimeError):
        await ResumeParserService(openrouter_api_key='test-only', openrouter_model='same-model', openrouter_fallback_model='same-model')._extract_nested_entries([section], timeout_seconds=3)
    assert len(calls) == 1
    assert 2.5 < calls[0]['timeout_seconds'] <= 3
    assert section.entries == []


@pytest.mark.asyncio
async def test_invalid_sibling_section_never_partially_replaces_valid_entries(monkeypatch):
    import json
    from app.services.resume_document import parse_resume_document
    document = parse_resume_document('## Experience\nAcme\nEngineer | 2020 - 2024\n- Built APIs.\n## Education\nExample University\nBachelor of Science 2016')
    original = document.model_dump()

    async def extract(**kwargs):
        experience, education = json.loads(kwargs['user_prompt'])['sections']
        return NestedExtractionOutput(sections=[
            {'section_id': experience['section_id'], 'entries': [{
                'source_start_line': 1, 'source_end_line': 3,
                'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2020 - 2024'},
                'bullets': [{'source_start_line': 3, 'source_end_line': 3}]
            }]},
            {'section_id': education['section_id'], 'entries': [{
                'source_start_line': 1, 'source_end_line': 2,
                'fields': {'institution': 'Example University', 'qualification': 'Bachelor of Science'}, 'bullets': []
            }]}
        ])

    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', extract)
    with pytest.raises(ValueError, match='Retain all source words'):
        await ResumeParserService(openrouter_api_key='test-only')._extract_nested_entries(document.sections, timeout_seconds=3)
    assert document.model_dump() == original
