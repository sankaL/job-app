from __future__ import annotations

from copy import deepcopy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import section_generation as pipeline
from resume_document import validate_resume_document, render_resume_document
from worker import build_generation_success_payload, _stored_generation_settings


def source_document():
    return {
        'schema_version': 1, 'revision': 7, 'sections': [
            {'id': 'summary-id', 'kind': 'summary', 'heading': 'Summary', 'enabled': True,
             'review_state': 'reviewed', 'content_md': 'Built Python APIs.'},
            {'id': 'experience-id', 'kind': 'professional_experience', 'heading': 'Professional Experience',
             'enabled': True, 'review_state': 'reviewed', 'content_md': '', 'entries': [
                {'id': 'role-one', 'fields': {'title': 'Backend Engineer', 'company': 'Acme', 'location': 'Toronto', 'date_range': '2020 - 2024'},
                 'bullets': [{'id': 'bullet-one', 'text': 'Built Python APIs with 35% lower latency.'},
                             {'id': 'bullet-two', 'text': 'Maintained FastAPI services.'}]},
                {'id': 'role-two', 'fields': {'title': 'Software Developer', 'company': 'Example', 'location': '', 'date_range': '2018 - 2020'},
                 'bullets': [{'id': 'bullet-three', 'text': 'Built internal tools.'}]},
             ]},
            {'id': 'education-id', 'kind': 'education', 'heading': 'Education', 'enabled': True,
             'review_state': 'reviewed', 'content_md': '', 'entries': [
                {'id': 'degree-one', 'fields': {'qualification': 'BSc Computer Science', 'institution': 'University', 'location': '', 'date_range': '2018'}, 'bullets': []},
             ]},
            {'id': 'custom-id', 'kind': 'custom', 'heading': 'Volunteer Work', 'enabled': True,
             'review_state': 'reviewed', 'content_md': 'Maintained Python tools for a local charity.'},
        ],
    }


def summary_output():
    return {'id': 'summary-id', 'paragraph': 'Built and maintained Python APIs.', 'source_ids': ['summary-id'], 'entries': []}


def experience_output(target_entry=False):
    entries = [
        {'id': 'role-one', 'title': 'Backend Engineer', 'bullets': [
            {'text': 'Improved Python API latency by 35% while maintaining FastAPI services.', 'source_ids': ['bullet-one', 'bullet-two']},
        ]},
    ]
    if not target_entry:
        entries.append({'id': 'role-two', 'title': 'Software Developer', 'bullets': [{'text': 'Created internal tools.', 'source_ids': ['bullet-three']}]})
    return {'id': 'experience-id', 'paragraph': '', 'source_ids': [], 'entries': entries}


def custom_output():
    return {'id': 'custom-id', 'paragraph': 'Maintained Python tools for a local charity.', 'source_ids': ['custom-id'], 'entries': []}


async def run_pipeline(monkeypatch, responses, **overrides):
    calls = []

    async def call(**kwargs):
        kwargs['budget'].requests += 1
        kwargs['budget'].attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        if kwargs['output_type'] is pipeline.GroundingAudit:
            payload = json.loads(kwargs['prompt'][1][1])
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id=section['id'], supported=True, issues=[]) for section in payload['sections_to_verify']])
        calls.append(kwargs)
        return pipeline.SectionBatch.model_validate(responses.pop(0))

    monkeypatch.setattr(pipeline, 'structured_call', call)
    settings = {'aggressiveness': 'medium', '_source_snapshot': {'base_resume_id': 'base-1'}}
    settings.update(overrides.pop('generation_settings', {}))
    result = await pipeline.generate_document(
        source_payload=source_document(), generation_settings=settings, section_preferences=[],
        job_title='Backend Engineer', company_name='Employer', job_description='Build Python APIs.',
        model='primary', fallback_model='fallback', api_key='test', base_url='https://provider.invalid/v1',
        on_progress=None, **overrides,
    )
    return result, calls


@pytest.mark.asyncio
async def test_batch_generation_freezes_metadata_and_repairs_only_failed_section(monkeypatch):
    invalid = experience_output()
    invalid['entries'][0]['bullets'][0]['text'] = 'Improved latency by 99%.'
    result, calls = await run_pipeline(monkeypatch, [
        {'sections': [summary_output(), invalid, custom_output()]},
        {'sections': [experience_output()]},
    ])
    assert len(calls) == 2
    first = json.loads(calls[0]['prompt'][1][1])
    second = json.loads(calls[1]['prompt'][1][1])
    assert [s['id'] for s in first['requested_sections']] == ['summary-id', 'experience-id', 'custom-id']
    assert [s['id'] for s in second['requested_sections']] == ['experience-id']
    assert calls[0]['budget'] is calls[1]['budget']
    doc = validate_resume_document(result['document'])
    experience = doc.sections[1]
    assert experience.entries[0].fields['company'] == 'Acme'
    assert experience.entries[0].fields['date_range'] == '2020 - 2024'
    assert experience.entries[0].bullets[0].source_ids == ['bullet-one', 'bullet-two']
    assert experience.entries[0].bullets[0].id.startswith('merged-')
    assert doc.sections[2].model_dump() == validate_resume_document(source_document()).sections[2].model_dump()
    assert result['source_snapshot']['revision'] == 7
    assert result['source_snapshot']['base_resume_id'] == 'base-1'
    assert result['source_snapshot']['document']['revision'] == 7
    checked = pipeline.validate_document_sections(
        generated_sections=result['sections'], source_payload=source_document(),
        generation_settings={'aggressiveness': 'medium'}, expected_ids=[s['name'] for s in result['sections']],
    )
    assert checked['valid'], checked


@pytest.mark.asyncio
async def test_entry_regeneration_preserves_every_other_entry_and_section(monkeypatch):
    current = validate_resume_document(source_document())
    current.sections[0].content_md = 'A user-edited summary.'
    current.sections[1].entries[1].bullets[0].text = 'An edited bullet in another role.'
    before = current.model_dump(mode='json')
    result, calls = await run_pipeline(monkeypatch, [{'sections': [experience_output(target_entry=True)]}],
        generation_settings={'_current_document': before, '_target_entry_id': 'role-one'},
        target_section_id='experience-id', instructions='Emphasize API delivery.',
    )
    after = result['document']
    assert after['sections'][0] == before['sections'][0]
    assert after['sections'][1]['entries'][1] == before['sections'][1]['entries'][1]
    assert after['sections'][2:] == before['sections'][2:]
    assert [entry['id'] for entry in json.loads(calls[0]['prompt'][1][1])['requested_sections'][0]['entries']] == ['role-one']


@pytest.mark.parametrize('change,code', [
    ('unknown_reference', 'cross_entry_source_reference'),
    ('missing_entry', 'entry_order_or_identity_mismatch'),
    ('extra_field', 'invalid_section_schema'),
    ('contact', 'contact_information'),
    ('numeric', 'unsupported_numeric_fact'),
    ('cross_role', 'cross_entry_source_reference'),
])
def test_hard_invalid_outputs_fail_closed(change, code):
    doc = validate_resume_document(source_document())
    output = experience_output()
    if change == 'unknown_reference':
        output['entries'][0]['bullets'][0]['source_ids'] = ['nonexistent']
    elif change == 'missing_entry':
        output['entries'].pop()
    elif change == 'extra_field':
        output['entries'][0]['company'] = 'Invented employer'
    elif change == 'contact':
        output['entries'][0]['bullets'][0]['text'] = 'Contact alex@example.com.'
    elif change == 'numeric':
        output['entries'][0]['bullets'][0]['text'] = 'Led a team of 90 engineers.'
    elif change == 'cross_role':
        output['entries'][0]['bullets'][0]['source_ids'] = ['bullet-three']
    with pytest.raises(pipeline.SectionValidationError, match=code):
        pipeline.apply_section_rewrite(source=doc.sections[1], rewrite=output, document=doc, aggressiveness='medium')


@pytest.mark.asyncio
async def test_missing_section_receives_targeted_repair_without_rewriting_valid_siblings(monkeypatch):
    result, calls = await run_pipeline(monkeypatch, [
        {'sections': [summary_output(), experience_output()]},
        {'sections': [custom_output()]},
    ])
    assert [section['id'] for section in json.loads(calls[1]['prompt'][1][1])['requested_sections']] == ['custom-id']
    assert len(result['document']['sections']) == 4


@pytest.mark.asyncio
async def test_exhausted_section_repairs_do_not_produce_a_draft(monkeypatch):
    with pytest.raises(RuntimeError, match='bounded repairs'):
        await run_pipeline(monkeypatch, [{'sections': []}, {'sections': []}, {'sections': []}])


def test_canonical_callback_keeps_exact_source_snapshot_out_of_public_settings():
    source = source_document()
    snapshot = {'revision': 7, 'base_resume_id': 'base-1', 'document': source, 'content_md': render_resume_document(source)}
    settings = {'page_length': '1_page', '_source_document': source, '_source_snapshot': snapshot, '_current_document': source, '_target_entry_id': 'role-one'}
    stored = _stored_generation_settings(settings)
    assert stored == {'page_length': '1_page'}
    payload = build_generation_success_payload(
        application_id='app', user_id='user', job_id='job', content_md='## Summary\nBuilt APIs.',
        generation_params=stored, sections_snapshot={}, document=source, source_snapshot=snapshot,
    )
    assert payload['generated']['source_snapshot'] == snapshot
    assert payload['generated']['document'] == source


def test_contact_source_is_masked_before_provider_invocation():
    doc = validate_resume_document(source_document())
    doc.sections[0].content_md += ' alex@example.com'
    prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections[:1], generation_settings={},
        job_title='Engineer', company_name='Acme', job_description='Build APIs.',
        instructions=None, current=None, target_entry_id=None)
    assert 'alex@example.com' not in prompt[1][1]
    assert 'alex@example.com' in doc.sections[0].content_md


@pytest.mark.asyncio
async def test_word_hard_cap_repairs_only_largest_editable_section(monkeypatch):
    oversized = summary_output()
    oversized['paragraph'] = 'Python ' * 860
    result, calls = await run_pipeline(monkeypatch, [
        {'sections': [oversized, experience_output(), custom_output()]},
        {'sections': [summary_output()]},
    ])
    assert [s['id'] for s in json.loads(calls[1]['prompt'][1][1])['requested_sections']] == ['summary-id']
    assert result['document']['sections'][1]['entries'][0]['fields']['company'] == 'Acme'


@pytest.mark.parametrize('location', ['disabled_prose', 'entry_metadata', 'identifier'])
def test_hidden_contact_values_are_masked_or_rejected_before_external_call(location):
    doc = validate_resume_document(source_document())
    if location == 'disabled_prose':
        doc.sections[-1].enabled = False
        doc.sections[-1].content_md = 'Contact alex@example.com'
    elif location == 'entry_metadata':
        doc.sections[1].entries[0].fields['notes'] = 'alex@example.com'
    else:
        doc.sections[-1].id = 'alex@example.com'
    if location == 'identifier':
        with pytest.raises(ValueError, match='contact information'):
            pipeline.build_section_prompt(source=doc, requested=doc.sections[:1], generation_settings={},
                job_title='Engineer', company_name='Acme', job_description='Build APIs.',
                instructions=None, current=None, target_entry_id=None)
    else:
        prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections[:1], generation_settings={},
            job_title='Engineer', company_name='Acme', job_description='Build APIs.',
            instructions=None, current=None, target_entry_id=None)
        assert 'alex@example.com' not in prompt[1][1]


def test_unsupported_credential_is_rejected_even_with_valid_source_refs():
    doc = validate_resume_document(source_document())
    rewrite = summary_output()
    rewrite['paragraph'] = 'PhD who built Python APIs.'
    with pytest.raises(pipeline.SectionValidationError, match='unsupported_employer_or_credential'):
        pipeline.apply_section_rewrite(source=doc.sections[0], rewrite=rewrite, document=doc, aggressiveness='medium')


@pytest.mark.asyncio
async def test_existing_frozen_snapshot_is_preserved_exactly(monkeypatch):
    document = validate_resume_document(source_document()).model_dump(mode='json')
    snapshot = {'base_resume_id': 'base-original', 'revision': 7, 'document': document,
                'content_md': render_resume_document(document, include_disabled=True), 'captured_at': '2026-09-30'}
    result, _ = await run_pipeline(monkeypatch, [{'sections': [summary_output(), experience_output(), custom_output()]}],
        generation_settings={'_source_snapshot': snapshot})
    assert result['source_snapshot'] == snapshot


@pytest.mark.parametrize('source_number,output_number', [('-35%', '+35%'), ('$500', '€500'), ('35,5', '355'), ('35%', '35')])
def test_numeric_facts_preserve_sign_currency_decimal_and_units(source_number, output_number):
    with pytest.raises(pipeline.SectionValidationError, match='unsupported_numeric_fact'):
        pipeline._check_grounding('Improved results by ' + output_number, ['source'], {'source': 'Improved results by ' + source_number})


def test_numeric_facts_accept_unambiguous_thousands_and_percent_formatting():
    pipeline._check_grounding('Handled 1000 requests with 35 percent lower latency.', ['source'],
        {'source': 'Handled 1,000 requests with 35% lower latency.'})


@pytest.mark.parametrize('markup', ['## Skills\nPython', '### Work\nPython', '<div>Python</div>', '| Skill | Value |\n|---|---|\n| Python | Used |'])
def test_model_authored_headings_html_and_tables_are_rejected(markup):
    with pytest.raises(pipeline.SectionValidationError, match='unsafe_markdown'):
        pipeline._check_grounding(markup, ['source'], {'source': 'Python'})


def test_outbound_profile_masking_covers_hidden_values_field_keys_and_uuid_digits():
    doc = validate_resume_document(source_document())
    doc.sections[-1].enabled = False
    doc.sections[-1].content_md = 'Alex Example lives at 45 Main Street.'
    doc.sections[1].entries[0].fields['alex@example.com'] = 'Alex Example'
    numeric_uuid = 'abcdef12345678901234567890abcdefab'
    doc.sections[0].id = numeric_uuid
    prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections[:1],
        generation_settings={'_privacy_values': ['Alex Example', '45 Main Street', 'alex@example.com']},
        job_title='Engineer', company_name='Acme', job_description='Alex Example may contact alex@example.com.',
        instructions='Alex Example asks for an edit.', current=doc, target_entry_id=None)
    serialized = prompt[1][1]
    assert 'Alex Example' not in serialized
    assert '45 Main Street' not in serialized
    assert 'alex@example.com' not in serialized
    assert numeric_uuid in serialized
    assert doc.sections[-1].content_md == 'Alex Example lives at 45 Main Street.'


@pytest.mark.asyncio
async def test_keyword_patches_preserve_manual_edits_order_metadata_and_unrequested_bullets(monkeypatch):
    current = validate_resume_document(source_document())
    current.sections[0].content_md = 'A manually edited summary.'
    current.sections[1].entries[0].bullets[1].text = 'An unrelated user-edited bullet.'
    current.sections[1].entries[1].fields['title'] = 'User-selected title'
    current.sections[2].entries[0].fields['qualification'] = 'A manually edited qualification.'
    current.sections = [current.sections[3], *current.sections[:3]]
    before = current.model_dump(mode='json')
    result, calls = await run_pipeline(monkeypatch, [{'sections': [{
        'id': 'experience-id', 'paragraph': None, 'source_ids': [], 'entries': [{
            'id': 'role-one', 'bullets': [{'id': 'bullet-one', 'text': 'Built Python APIs with 35% lower latency using FastAPI.', 'source_ids': ['bullet-one', 'bullet-two']}],
        }],
    }]}], generation_settings={'_operation': 'keyword_optimization', '_current_document': before})
    after = result['document']
    assert [s['id'] for s in after['sections']] == [s['id'] for s in before['sections']]
    assert after['sections'][0] == before['sections'][0]
    assert after['sections'][1] == before['sections'][1]
    assert after['sections'][3] == before['sections'][3]
    assert after['sections'][2]['entries'][0]['bullets'][1] == before['sections'][2]['entries'][0]['bullets'][1]
    assert after['sections'][2]['entries'][1] == before['sections'][2]['entries'][1]
    assert after['sections'][2]['entries'][0]['bullets'][0]['id'] == 'bullet-one'
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_semantic_audit_rejects_changed_metric_meaning_then_repairs_only_failed_section(monkeypatch):
    writer_calls = []
    audits = []
    invalid = experience_output()
    invalid['entries'][0]['bullets'][0]['text'] = 'Cut cloud costs by 35% using Rust and Kubernetes.'
    writes = [{'sections': [summary_output(), invalid, custom_output()]}, {'sections': [experience_output()]}]
    async def call(**kwargs):
        kwargs['budget'].requests += 1
        kwargs['budget'].attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['output_type'] is pipeline.GroundingAudit:
            audits.append(payload)
            first = len(audits) == 1
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(
                id=section['id'], supported=not(first and section['id']=='experience-id'),
                issues=['unsupported_technology','unsupported_metric'] if first and section['id']=='experience-id' else [],
            ) for section in payload['sections_to_verify']])
        writer_calls.append(payload)
        return pipeline.SectionBatch.model_validate(writes.pop(0))
    monkeypatch.setattr(pipeline, 'structured_call', call)
    result = await pipeline.generate_document(source_payload=source_document(), generation_settings={'aggressiveness':'medium'},
        section_preferences=[], job_title='Engineer', company_name='Employer', job_description='Rust and Kubernetes',
        model='primary', fallback_model='fallback', api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    assert [s['id'] for s in writer_calls[1]['requested_sections']] == ['experience-id']
    assert [s['id'] for s in audits[1]['sections_to_verify']] == ['experience-id']
    assert 'Rust' not in render_resume_document(result['document'])


@pytest.mark.asyncio
async def test_entry_audit_scope_excludes_unrelated_user_edits(monkeypatch):
    current = validate_resume_document(source_document())
    current.sections[1].entries[1].bullets[0].text = 'An unrelated manually edited fact.'
    audits = []
    async def call(**kwargs):
        kwargs['budget'].requests += 1
        kwargs['budget'].attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        if kwargs['output_type'] is pipeline.GroundingAudit:
            payload = json.loads(kwargs['prompt'][1][1]); audits.append(payload)
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id=s['id'], supported=True) for s in payload['sections_to_verify']])
        return pipeline.SectionBatch(sections=[experience_output(target_entry=True)])
    monkeypatch.setattr(pipeline, 'structured_call', call)
    result = await pipeline.generate_document(source_payload=source_document(),
        generation_settings={'_current_document':current.model_dump(), '_target_entry_id':'role-one'}, section_preferences=[],
        target_section_id='experience-id', instructions='Emphasize APIs.', job_title='Engineer', company_name='Employer', job_description='APIs',
        model='primary', fallback_model='fallback', api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    assert [entry['id'] for entry in audits[0]['sections_to_verify'][0]['entries']] == ['role-one']
    assert result['document']['sections'][1]['entries'][1] == current.sections[1].entries[1].model_dump()


@pytest.mark.asyncio
async def test_frozen_only_document_over_hard_cap_fails_without_provider_call(monkeypatch):
    doc = {'schema_version':1,'revision':1,'sections':[{'id':'education-only','kind':'education','heading':'Education',
        'enabled':True,'review_state':'reviewed','content_md':'Education '*900}]}
    async def no_call(**kwargs):
        raise AssertionError('Fixed facts must not call a provider.')
    monkeypatch.setattr(pipeline,'structured_call',no_call)
    with pytest.raises(pipeline.SectionGenerationError, match='fixed_source_content_above_word_hard_cap'):
        await pipeline.generate_document(source_payload=doc,generation_settings={},section_preferences=[],job_title='Engineer',company_name='Employer',job_description='APIs',
            model='primary',fallback_model='fallback',api_key='test',base_url='https://provider.invalid/v1',on_progress=None)


def test_reviewed_opaque_experience_copy_accepts_source_role_subheadings():
    doc = validate_resume_document({'schema_version':1,'revision':1,'sections':[{'id':'opaque-experience','kind':'professional_experience','heading':'Experience',
        'enabled':True,'review_state':'reviewed','content_md':'### Acme\nEngineer, 2020 - 2024\n- Built APIs.'}]})
    checked = pipeline.validate_document_sections(generated_sections=pipeline.document_sections(doc), source_payload=doc,
        generation_settings={}, expected_ids=['opaque-experience'])
    assert checked['valid'], checked


@pytest.mark.parametrize('source_number,output_number', [('.5%', '5%'), ('−35%', '+35%'), ('$500','USD 500')])
def test_numeric_precision_and_ambiguous_dollar_currency_are_preserved(source_number,output_number):
    with pytest.raises(pipeline.SectionValidationError,match='unsupported_numeric_fact'):
        pipeline._check_grounding('Improved by '+output_number,['source'],{'source':'Improved by '+source_number})


@pytest.mark.asyncio
async def test_entry_regeneration_preserves_added_reordered_current_siblings_and_heading(monkeypatch):
    current=validate_resume_document(source_document())
    added=current.sections[1].entries[1].model_copy(deep=True)
    added.id='user-added-role';added.bullets[0].id='user-added-bullet'
    added.bullets[0].text='A manually added role.'
    current.sections[1].heading='Selected Work'
    current.sections[1].entries=[added,current.sections[1].entries[1],current.sections[1].entries[0]]
    before=current.model_dump(mode='json')
    result,_=await run_pipeline(monkeypatch,[{'sections':[experience_output(target_entry=True)]}],
        generation_settings={'_current_document':before,'_target_entry_id':'role-one'},
        target_section_id='experience-id',instructions='Emphasize APIs.')
    assert result['document']['sections'][1]['heading']=='Selected Work'
    assert result['document']['sections'][1]['entries'][:2]==before['sections'][1]['entries'][:2]
    target=next(section for section in result['sections'] if section['name']=='experience-id')
    checked=pipeline.validate_document_sections(generated_sections=[target],source_payload=source_document(),
        generation_settings={'_current_document':before,'_target_entry_id':'role-one','_operation':'regeneration_section'},
        expected_ids=['experience-id'])
    assert checked['valid'],checked
