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
            "entries": [{"fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": ["Built APIs."]}],
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
            "entries": [{"fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": []}],
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
async def test_nested_extraction_cannot_omit_technology_or_metric_suffixes(monkeypatch, source_fact, truncated_fact):
    async def invoke(**kwargs):
        if kwargs["output_type"] is CleanupOutput:
            return CleanupOutput(cleaned_markdown=kwargs["user_prompt"], needs_review=False, review_reason=None)
        import json
        payload = json.loads(kwargs["user_prompt"])
        return NestedExtractionOutput(sections=[{
            "section_id": payload["sections"][0]["section_id"],
            "entries": [{"fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"}, "bullets": [truncated_fact]}],
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
    first = await parser.import_resume(source)
    second = await parser.import_resume(source)
    parsed = validate_resume_document(first.document)
    assert [section.kind for section in parsed.sections] == ["professional_experience"] * 3
    assert len({entry.id for section in parsed.sections for entry in section.entries}) == 3
    assert len({bullet.id for section in parsed.sections for entry in section.entries for bullet in entry.bullets}) == 3
    assert first.document == second.document
    assert first.warning is None

@pytest.mark.asyncio
async def test_multi_job_import_uses_local_boundaries_before_ai_assistance(monkeypatch):
    async def unexpected(**_kwargs):
        raise AssertionError('Recognizable headers should need no generative call.')
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', unexpected)
    body = 'Acme | Toronto\nEngineer | 2022 - Present\n- Built APIs.\nBeta | Remote\nDeveloper | 2019 - 2022\n- Built C++ tools.'
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
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
        return NestedExtractionOutput(sections=[{'section_id': section_id, 'entries': [{'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': ['Built APIs.', 'Beta', 'Developer', '2019 - 2022', 'Built tools.']}]}])
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
            {'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': ['Built APIs.']},
            {'fields': {'company': 'Beta', 'title': 'Developer', 'date_range': '2019 - 2022'}, 'bullets': ['Built tools.']},
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
            {'fields': {'company': 'Beta', 'title': 'Developer', 'date_range': '2019 - 2022'}, 'bullets': ['Built tools.']},
            {'fields': {'company': 'Acme', 'title': 'Engineer', 'date_range': '2022 - Present'}, 'bullets': ['Built APIs.']},
        ]}])
    monkeypatch.setattr('app.services.resume_parser.invoke_import_output', reversed_jobs)
    result = await ResumeParserService(openrouter_api_key='test-key', classifier='local').import_resume('## Experience\n' + body, use_llm_cleanup=True)
    assert result.document['sections'][0]['entries'] == []
    assert result.document['sections'][0]['content_md'] == body
    assert 'could not be structured safely' in result.warning
