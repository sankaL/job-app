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


@pytest.mark.parametrize('batch_type', [pipeline.SectionBatch, pipeline.KeywordSectionBatch])
def test_provider_schema_exposes_nested_sections_but_preserves_local_item_parsing(batch_type):
    schema = batch_type.model_json_schema()
    item = schema['properties']['sections']['items']
    assert set(item['properties']) == {'id', 'paragraph', 'source_ids', 'entries'}
    assert item['additionalProperties'] is False
    malformed = {'id': 'experience-id', 'unexpected_field': 'Rejected locally'}
    result = batch_type.model_validate({'sections': [malformed]})
    assert result.sections == [malformed]
    with pytest.raises(ValueError, match='items_must_be_objects'):
        batch_type.model_validate({'sections': ['Not a JSON object']})


def test_output_shape_diagnostics_never_store_untrusted_ids_keys_or_content():
    budget = pipeline.CallBudget.for_seconds(5)
    budget.attempts.append({'outcome': 'success'})
    pipeline.record_output_shape(budget, [
        {'id': 'contact@example.test', 'arbitrary-secret-key': 'Private body'},
        {'id': 'education', 'heading': 'Private heading'}, {'name': 'Private name'},
    ], {'summary-id'})
    encoded = json.dumps(budget.attempts)
    assert 'contact@example.test' not in encoded
    assert 'arbitrary-secret-key' not in encoded
    assert 'Private' not in encoded
    shape = budget.attempts[-1]['output_shape']
    assert shape['unexpected_known_kind_tokens'] == ['education']
    assert shape['missing_id_count'] == 1
    assert shape['unexpected_id_count'] == 3


def requested_ids(kwargs):
    return [section['id'] for section in json.loads(kwargs['prompt'][1][1])['requested_sections']]


def serve_requested(responses, kwargs):
    """Serve one round's scripted batch to concurrent writer groups.

    Each call receives only the scripted sections it requested; the round's batch
    is consumed once every scripted section has been served.
    """
    wanted = set(requested_ids(kwargs))
    batch = responses[0]
    sections = batch.get('sections', [])
    served = [item for item in sections if item.get('id') in wanted]
    batch['sections'] = [item for item in sections if item.get('id') not in wanted]
    extra = {key: value for key, value in batch.items() if key != 'sections'}
    if not batch['sections']:
        responses.pop(0)
    return {**extra, 'sections': served}


async def run_pipeline(monkeypatch, responses, **overrides):
    calls = []

    async def call(**kwargs):
        kwargs['budget'].requests += 1
        kwargs['budget'].attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        if kwargs['output_type'] is pipeline.GroundingAudit:
            payload = json.loads(kwargs['prompt'][1][1])
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id=section['id'], supported=True, issues=[]) for section in payload['sections_to_verify']])
        calls.append(kwargs)
        return pipeline.SectionBatch.model_validate(serve_requested(responses, kwargs))

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
    # Experience and the other sections are written concurrently; only Experience is repaired.
    assert [requested_ids(call) for call in calls] == [['experience-id'], ['summary-id', 'custom-id'], ['experience-id']]
    assert calls[0]['budget'] is calls[1]['budget'] is calls[2]['budget']
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
    assert requested_ids(calls[-1]) == ['custom-id'] and len(calls) == 3
    assert len(result['document']['sections']) == 4


@pytest.mark.asyncio
async def test_malformed_nested_sibling_repairs_only_its_section(monkeypatch):
    malformed = experience_output()
    malformed['entries'][0]['company'] = 'Do not allow writer factual fields'
    result, calls = await run_pipeline(monkeypatch, [
        {'sections': [summary_output(), malformed, custom_output()]},
        {'sections': [experience_output()]},
    ])
    repaired_payload = json.loads(calls[-1]['prompt'][1][1])
    assert repaired_payload['allowed_section_ids'] == ['experience-id']
    assert [section['id'] for section in repaired_payload['requested_sections']] == ['experience-id']
    assert result['document']['sections'][0]['content_md'] == summary_output()['paragraph']
    assert result['document']['sections'][3]['content_md'] == custom_output()['paragraph']


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
    assert requested_ids(calls[-1]) == ['summary-id']
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
            first = sum('experience-id' in [s['id'] for s in a['sections_to_verify']] for a in audits) == 1
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(
                id=section['id'], supported=not(first and section['id']=='experience-id'),
                issues=['unsupported_technology','unsupported_metric'] if first and section['id']=='experience-id' else [],
            ) for section in payload['sections_to_verify']])
        writer_calls.append(payload)
        kwargs = {**kwargs, 'prompt': kwargs['prompt']}
        return pipeline.SectionBatch.model_validate(serve_requested(writes, kwargs))
    monkeypatch.setattr(pipeline, 'structured_call', call)
    result = await pipeline.generate_document(source_payload=source_document(), generation_settings={'aggressiveness':'medium'},
        section_preferences=[], job_title='Engineer', company_name='Employer', job_description='Rust and Kubernetes',
        model='primary', fallback_model='fallback', api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    assert [s['id'] for s in writer_calls[-1]['requested_sections']] == ['experience-id']
    assert [s['id'] for s in audits[-1]['sections_to_verify']] == ['experience-id']
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

@pytest.mark.asyncio
async def test_full_writer_fallback_and_repairs_audits_use_distinct_operation_tiers(monkeypatch):
    calls = []
    writes = 0
    async def call(**kwargs):
        nonlocal writes
        calls.append((kwargs['operation'], kwargs['model_name']))
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['operation'] == 'section_grounding_audit':
            return pipeline.GroundingAudit(sections=[{'id':s['id'],'supported':True,'issues':[]} for s in payload['sections_to_verify']])
        if kwargs['model_name'] == 'tier1-primary':
            raise RuntimeError('Synthetic transport failure')
        writes += 1
        outputs = {'summary-id':summary_output(), 'experience-id':experience_output(), 'custom-id':custom_output()}
        requested = payload['requested_sections']
        items = {'sections':[outputs[item['id']] for item in requested]}
        if writes == 1:
            items['sections'][0]['paragraph'] = 'Invented +999% metric.'
        return pipeline.SectionBatch.model_validate(items)
    monkeypatch.setattr(pipeline,'structured_call',call)
    result = await pipeline.generate_document(source_payload=source_document(),
        generation_settings={'aggressiveness':'medium','_routine_model':'tier2-primary','_routine_fallback_model':'tier2-fallback',
            '_repair_model':'tier1-primary','_repair_fallback_model':'tier1-fallback'},
        section_preferences=[],job_title='Engineer',company_name='Example',job_description='Build APIs',
        model='tier1-primary',fallback_model='tier1-fallback',api_key='test',base_url='https://provider.invalid/v1',on_progress=None)
    assert calls[:2] == [('section_generation','tier1-primary'),('section_generation','tier1-fallback')]
    # LLM audits use Tier 1 (Sonnet) with Tier 2 fallback; repairs use Tier 1 with its fallback.
    assert all(model == 'tier1-primary' for operation, model in calls if operation == 'section_grounding_audit')
    assert {model for operation, model in calls if operation == 'section_repair'} <= {'tier1-primary', 'tier1-fallback'}
    assert not any(model.startswith('tier2') for operation, model in calls if operation != 'section_grounding_audit')
    assert any(operation == 'section_repair' for operation,_ in calls)
    assert result['document']

@pytest.mark.asyncio
async def test_repeated_semantic_rejection_supplies_feedback_and_switches_repair_writer(monkeypatch):
    writes = []
    audits = 0
    async def call(**kwargs):
        nonlocal audits
        kwargs['budget'].requests += 1
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['operation'] == 'section_grounding_audit':
            audits += any(s['id'] == 'summary-id' for s in payload['sections_to_verify'])
            return pipeline.GroundingAudit(sections=[{'id':s['id'],
                'supported':s['id'] != 'summary-id' or audits > 2,
                'issues':['unsupported_scope'] if s['id']=='summary-id' and audits <= 2 else []}
                for s in payload['sections_to_verify']])
        writes.append(kwargs)
        outputs = {'summary-id':summary_output(),'experience-id':experience_output(),'custom-id':custom_output()}
        return pipeline.SectionBatch.model_validate({'sections':[outputs[s['id']] for s in payload['requested_sections']]})
    monkeypatch.setattr(pipeline,'structured_call',call)
    await pipeline.generate_document(source_payload=source_document(),generation_settings={
        'aggressiveness':'high','_routine_model':'tier2-primary','_routine_fallback_model':'tier2-fallback',
        '_repair_model':'repair-primary','_repair_fallback_model':'repair-fallback'},
        section_preferences=[],job_title='Engineer',company_name='Example',job_description='Build APIs',
        model='tier1-primary',fallback_model='tier1-fallback',api_key='test',base_url='https://provider.invalid/v1',on_progress=None)
    # Round 0 writes both groups; repeated Summary rejection switches to the repair fallback writer.
    assert [write['model_name'] for write in writes] == ['tier1-primary','tier1-primary','repair-primary','repair-fallback']
    for write in writes[2:]:
        feedback = json.loads(write['prompt'][-1][1])
        assert feedback['repair_only_section_ids'] == ['summary-id']
        assert feedback['rejected_outputs'][0]['id'] == 'summary-id'
        assert feedback['repair_errors'] == {'summary-id':'unsupported_scope'}


@pytest.mark.asyncio
async def test_initial_structure_ignores_legacy_profile_preferences(monkeypatch):
    calls = []
    async def call(**kwargs):
        calls.append(kwargs)
        if kwargs['output_type'] is pipeline.GroundingAudit:
            payload = json.loads(kwargs['prompt'][1][1])
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id=s['id'], supported=True, issues=[]) for s in payload['sections_to_verify']])
        wanted = requested_ids(kwargs)
        return pipeline.SectionBatch(sections=[item for item in [custom_output(), summary_output(), experience_output()] if item['id'] in wanted])
    monkeypatch.setattr(pipeline, 'structured_call', call)
    source = source_document()
    source['sections'] = [source['sections'][3], *source['sections'][:3]]
    source['sections'][3]['enabled'] = False
    result = await pipeline.generate_document(source_payload=source, generation_settings={},
        section_preferences=[{'name': 'custom', 'enabled': False, 'order': 9}, {'name': 'summary', 'enabled': False, 'order': 0}],
        job_title='Engineer', company_name='Acme', job_description='Build APIs.', model='primary', fallback_model='fallback',
        api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    assert result['section_ids'] == ['custom-id', 'summary-id', 'experience-id']
    assert [s['id'] for s in result['document']['sections']] == [s['id'] for s in source['sections']]
    assert result['document']['sections'][3]['enabled'] is False
    assert 'education-id' not in [s['id'] for s in json.loads(calls[0]['prompt'][1][1])['reviewed_source']['sections']]
    audits = [call for call in calls if call['output_type'] is pipeline.GroundingAudit]
    assert audits and all('University' not in call['prompt'][1][1] for call in audits)


@pytest.mark.asyncio
async def test_full_regeneration_preserves_saved_layout_and_local_sections(monkeypatch):
    current = deepcopy(source_document())
    current['sections'][0]['enabled'] = False
    current['sections'][0]['content_md'] = 'Keep this excluded edit.'
    current['sections'][2]['entries'][0]['fields']['qualification'] = 'Manually corrected qualification'
    current['sections'][3]['heading'] = 'Community work'
    current['sections'].append({'id': 'draft-only', 'kind': 'custom', 'heading': 'Awards', 'enabled': True,
        'review_state': 'needs_review', 'content_md': 'User-entered award.'})
    current['sections'] = [current['sections'][3], current['sections'][4], *current['sections'][:3]]
    result, calls = await run_pipeline(monkeypatch, [{'sections': [custom_output(), experience_output()]}],
        generation_settings={'_operation': 'regeneration_full', '_current_document': current})
    output = result['document']
    assert [s['id'] for s in output['sections']] == [s['id'] for s in current['sections']]
    assert output['sections'][0]['heading'] == 'Community work'
    for index in [1, 2, 4]:
        assert validate_resume_document(output).sections[index] == validate_resume_document(current).sections[index]
    payloads = [json.loads(call['prompt'][1][1]) for call in calls]
    assert sorted(requested_ids(call) for call in calls) == [['custom-id'], ['experience-id']]
    assert all('Keep this excluded edit' not in json.dumps(payload) for payload in payloads)
    assert all('User-entered award' not in json.dumps(payload) for payload in payloads)
    checked = pipeline.validate_document_sections(generated_sections=result['sections'], source_payload=source_document(),
        generation_settings={'_operation': 'regeneration_full', '_current_document': current}, expected_ids=result['section_ids'])
    assert checked['valid'], checked
    result['sections'][1]['_canonical_section']['content_md'] = 'Unexpected rewrite'
    checked = pipeline.validate_document_sections(generated_sections=result['sections'], source_payload=source_document(),
        generation_settings={'_operation': 'regeneration_full', '_current_document': current}, expected_ids=result['section_ids'])
    assert not checked['valid']


@pytest.mark.asyncio
async def test_full_regeneration_does_not_restore_removed_roles_or_drop_added_roles(monkeypatch):
    current = deepcopy(source_document())
    current['sections'][1]['entries'] = [current['sections'][1]['entries'][1]]
    current['sections'][1]['entries'].append({'id': 'local-role', 'fields': {'company': 'User company', 'title': 'Engineer'}, 'bullets': []})
    result, calls = await run_pipeline(monkeypatch, [{'sections': [summary_output(), custom_output()]}],
        generation_settings={'_operation': 'regeneration_full', '_current_document': current})
    assert validate_resume_document(result['document']).sections[1] == validate_resume_document(current).sections[1]
    assert 'experience-id' not in [s['id'] for s in json.loads(calls[0]['prompt'][1][1])['requested_sections']]


@pytest.mark.asyncio
async def test_section_regeneration_can_use_reviewed_previously_excluded_source(monkeypatch):
    source = source_document()
    source['sections'][3]['enabled'] = False
    current = deepcopy(source)
    current['sections'][3]['enabled'] = True
    current['sections'][3]['heading'] = 'Community work'
    async def call(**kwargs):
        if kwargs['output_type'] is pipeline.GroundingAudit:
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id='custom-id', supported=True, issues=[])])
        return pipeline.SectionBatch(sections=[custom_output()])
    monkeypatch.setattr(pipeline, 'structured_call', call)
    result = await pipeline.generate_document(source_payload=source, generation_settings={'_current_document': current},
        section_preferences=[{'name': 'custom', 'enabled': False}], target_section_id='custom-id', instructions='Keep community work.',
        job_title='Engineer', company_name='Acme', job_description='Build APIs.', model='primary', fallback_model='fallback',
        api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    assert result['document']['sections'][3]['enabled']
    assert result['document']['sections'][3]['heading'] == 'Community work'
    source['sections'][3]['review_state'] = 'needs_review'
    with pytest.raises(ValueError, match='Review the source'):
        await pipeline.generate_document(source_payload=source, generation_settings={'_current_document': current},
            section_preferences=[], target_section_id='custom-id', instructions='Keep community work.',
            job_title='Engineer', company_name='Acme', job_description='Build APIs.', model='primary', fallback_model='fallback',
            api_key='test', base_url='https://provider.invalid/v1', on_progress=None)


@pytest.mark.asyncio
async def test_keyword_regeneration_preserves_custom_order_exclusions_and_local_edits(monkeypatch):
    current = deepcopy(source_document())
    current['sections'][0]['enabled'] = False
    current['sections'][0]['content_md'] = 'Excluded private edit'
    current['sections'] = [current['sections'][3], *current['sections'][:3]]
    result, calls = await run_pipeline(monkeypatch, [{'sections': []}],
        generation_settings={'_operation': 'keyword_optimization', '_current_document': current})
    assert validate_resume_document(result['document']).sections == validate_resume_document(current).sections
    assert result['section_ids'] == ['custom-id', 'experience-id', 'education-id']
    assert 'Excluded private edit' not in json.dumps(calls[0]['prompt'])
    assert result['source_snapshot']['document'] == validate_resume_document(source_document()).model_dump(mode='json')


@pytest.mark.asyncio
async def test_whole_section_regeneration_rejects_removed_or_reordered_entries_before_provider(monkeypatch):
    current = deepcopy(source_document())
    current['sections'][1]['entries'].reverse()
    with pytest.raises(ValueError, match='entry structure changed'):
        await run_pipeline(monkeypatch, [], target_section_id='experience-id', instructions='Rewrite', generation_settings={'_current_document': current})


@pytest.mark.asyncio
async def test_grounding_context_keeps_included_cross_section_citations_and_omits_excluded_source(monkeypatch):
    calls = []
    async def call(**kwargs):
        payload = json.loads(kwargs['prompt'][1][1])
        calls.append(payload)
        if kwargs['output_type'] is pipeline.GroundingAudit:
            assert [s['id'] for s in payload['reviewed_source']['sections']] == ['summary-id', 'experience-id']
            return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id='summary-id', supported=True, issues=[])])
        assert [s['id'] for s in payload['reviewed_source']['sections']] == ['summary-id', 'experience-id', 'education-id']
        return pipeline.SectionBatch(sections=[{'id': 'summary-id', 'paragraph': 'Built Python APIs with 35% lower latency.', 'source_ids': ['bullet-one'], 'entries': []}])
    monkeypatch.setattr(pipeline, 'structured_call', call)
    source = source_document()
    current = deepcopy(source)
    current['sections'][3]['enabled'] = False
    result = await pipeline.generate_document(source_payload=source, generation_settings={'_current_document': current},
        section_preferences=[], target_section_id='summary-id', instructions='Use the source API metric.',
        job_title='Engineer', company_name='Acme', job_description='Build APIs.', model='primary', fallback_model='fallback',
        api_key='test', base_url='https://provider.invalid/v1', on_progress=None)
    # Summary implicitly cites its own reviewed source alongside the cited Experience bullet.
    assert result['document']['sections'][0]['source_ids'] == ['bullet-one', 'summary-id']
    assert all('custom-id' not in [s['id'] for s in payload['reviewed_source']['sections']] for payload in calls)


@pytest.mark.asyncio
async def test_worker_full_validation_carries_operation_into_canonical_boundary(monkeypatch):
    from time import monotonic
    from worker import _validate_generated_sections_with_repair
    current = deepcopy(source_document())
    current['sections'][3]['heading'] = 'Community work'
    current['sections'].append({'id': 'local-awards', 'kind': 'custom', 'heading': 'Awards', 'enabled': True,
        'review_state': 'needs_review', 'content_md': 'User-entered award'})
    settings = {'aggressiveness': 'medium', '_source_document': source_document(), '_current_document': current}
    result, _ = await run_pipeline(monkeypatch, [{'sections': [summary_output(), experience_output(), custom_output()]}], generation_settings={**settings, '_operation': 'regeneration_full'})
    _, validation, _, _ = await _validate_generated_sections_with_repair(
        generated_sections=result['sections'], base_resume_content='', section_preferences=[], generation_settings=settings,
        professional_experience_anchors=[], prompt=result['prompt'], section_ids=result['section_ids'], operation='regeneration_full',
        model='primary', fallback_model='fallback', model_used='primary', attempt_diagnostics=[], api_key='test',
        base_url='https://provider.invalid/v1', repair_deadline=monotonic()+240, on_progress=None)
    assert validation['valid'], validation


@pytest.mark.asyncio
async def test_claim_audit_prompt_omits_unslop_policy(monkeypatch):
    from llm_runtime import CallBudget
    captured = {}

    async def call(**kwargs):
        captured['system'] = kwargs['prompt'][0][1]
        payload = json.loads(kwargs['prompt'][1][1])
        return pipeline.GroundingAudit(sections=[pipeline.GroundingAssessment(id=section['id'], supported=True, issues=[]) for section in payload['sections_to_verify']])

    monkeypatch.setattr(pipeline, 'structured_call', call)
    source = validate_resume_document(source_document())
    section = next(item for item in source.sections if item.id == 'summary-id')
    await pipeline.audit_section_grounding(
        sections=[section], source=source, generation_settings={}, model='primary',
        api_key='test-key', base_url='https://example.invalid', budget=CallBudget.for_seconds(30),
    )
    assert 'Unslop' not in captured['system']
    assert captured['system'].startswith('Check rewritten resume claims')


def _budgeted_call(writes, audit_plan, failing_models=()):
    """Fake provider that spends the shared budget like structured_call does."""
    import asyncio
    calls = []
    async def call(**kwargs):
        budget = kwargs['budget']
        budget.remaining_seconds()
        budget.requests += 1
        calls.append((kwargs['operation'], kwargs['model_name']))
        if kwargs['model_name'] in failing_models or (kwargs['operation'] == 'section_grounding_audit' and audit_plan and audit_plan[0] == 'timeout'):
            if kwargs['operation'] == 'section_grounding_audit' and audit_plan and audit_plan[0] == 'timeout':
                audit_plan.pop(0)
            budget.attempts.append({'model': kwargs['model_name'], 'outcome': 'timeout'})
            raise asyncio.TimeoutError('AI provider request timed out.')
        budget.attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['operation'] == 'section_grounding_audit':
            flagged = audit_plan.pop(0) if audit_plan else set()
            return pipeline.GroundingAudit(sections=[{'id': s['id'], 'supported': s['id'] not in flagged,
                'issues': ['unsupported_scope'] if s['id'] in flagged else []} for s in payload['sections_to_verify']])
        writes.append(kwargs['model_name'])
        outputs = {'summary-id': summary_output(), 'experience-id': experience_output(), 'custom-id': custom_output()}
        return pipeline.SectionBatch.model_validate({'sections': [outputs[s['id']] for s in payload['requested_sections']]})
    return call, calls


async def _generate(monkeypatch, call):
    monkeypatch.setattr(pipeline, 'structured_call', call)
    return await pipeline.generate_document(source_payload=source_document(), generation_settings={
        'aggressiveness': 'medium', '_routine_model': 'tier2-primary', '_routine_fallback_model': 'tier2-fallback'},
        section_preferences=[], job_title='Engineer', company_name='Example', job_description='Build APIs',
        model='tier1-primary', fallback_model='tier1-fallback', api_key='test', base_url='https://provider.invalid/v1', on_progress=None)


@pytest.mark.asyncio
async def test_audit_fallback_still_leaves_room_to_audit_the_final_repair(monkeypatch):
    # Production sequence: the first audit times out, then Summary is rejected in every round.
    import asyncio
    writes, calls, state = [], [], {'timed_out': False}
    async def call(**kwargs):
        budget = kwargs['budget']
        budget.remaining_seconds()
        budget.requests += 1
        calls.append((kwargs['operation'], kwargs['model_name']))
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['operation'] == 'section_grounding_audit':
            if not state['timed_out']:
                state['timed_out'] = True
                budget.attempts.append({'model': kwargs['model_name'], 'outcome': 'timeout'})
                raise asyncio.TimeoutError('AI provider request timed out.')
            budget.attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
            return pipeline.GroundingAudit(sections=[{'id': s['id'], 'supported': s['id'] != 'summary-id',
                'issues': ['unsupported_scope'] if s['id'] == 'summary-id' else []} for s in payload['sections_to_verify']])
        budget.attempts.append({'model': kwargs['model_name'], 'outcome': 'success'})
        writes.append(kwargs['model_name'])
        outputs = {'summary-id': summary_output(), 'experience-id': experience_output(), 'custom-id': custom_output()}
        return pipeline.SectionBatch.model_validate({'sections': [outputs[s['id']] for s in payload['requested_sections']]})
    result = await _generate(monkeypatch, call)
    # Two writes + three audits (one fallback) in round 0, then write + audit in rounds 1 and 2.
    assert len(calls) == 9 <= pipeline.WRITING_MAX_REQUESTS
    assert calls[-1][0] == 'section_grounding_audit'
    # The unverifiable Summary keeps its source text; the generation still succeeds.
    assert result['fallback_sections'] == [{'section_id': 'summary-id', 'codes': 'unsupported_scope'}]
    summary = result['document']['sections'][0]
    assert summary['generation_notice'] == 'kept_original_unverified'
    assert summary['content_md'] == source_document()['sections'][0]['content_md']
    assert result['document']['sections'][1]['generation_notice'] is None


@pytest.mark.asyncio
async def test_repair_round_is_not_started_without_budget_for_its_audit(monkeypatch):
    # Every primary call fails, so each write and audit spends two requests.
    writes = []
    call, calls = _budgeted_call(writes, [{'summary-id'}] * 6, failing_models=('tier1-primary',))
    result = await _generate(monkeypatch, call)
    assert len(calls) == pipeline.WRITING_MAX_REQUESTS
    assert len(result['attempt_diagnostics']) == pipeline.WRITING_MAX_REQUESTS
    assert [item['section_id'] for item in result['fallback_sections']] == ['summary-id']


@pytest.mark.asyncio
async def test_exhausted_budget_marks_audit_unavailable_instead_of_raising(monkeypatch):
    call, calls = _budgeted_call([], [])
    monkeypatch.setattr(pipeline, 'structured_call', call)
    budget = pipeline.CallBudget.for_seconds(5, max_requests=1)
    budget.requests = 1
    doc = validate_resume_document(source_document())
    result = await pipeline.audit_section_grounding(sections=doc.sections[:1], source=doc, generation_settings={},
        model='tier2-primary', fallback_model='tier2-fallback', api_key='test', base_url='https://provider.invalid/v1', budget=budget)
    assert result == {'summary-id': 'grounding_audit_unavailable'}
    assert calls == []


def test_high_allows_plausible_new_metrics_but_keeps_years_and_strict_modes_bound():
    texts = {'bullet-one': 'Built Python APIs in 2021.'}
    pipeline._check_grounding('Built Python APIs serving 2M requests and cut latency 30%.', ['bullet-one'], texts, aggressiveness='high')
    with pytest.raises(pipeline.SectionValidationError, match='unsupported_numeric_fact'):
        pipeline._check_grounding('Built Python APIs serving 2M requests and cut latency 30%.', ['bullet-one'], texts, aggressiveness='medium')
    with pytest.raises(pipeline.SectionValidationError, match='unsupported_numeric_fact'):
        pipeline._check_grounding('Built Python APIs in 2019.', ['bullet-one'], texts, aggressiveness='high')


@pytest.mark.parametrize('aggressiveness,operation,expected', [
    ('high', 'generation', pipeline.HIGH_FIT_CLAIM_POLICY),
    ('medium', 'generation', pipeline.STRICT_CLAIM_POLICY),
    ('low', 'generation', pipeline.STRICT_CLAIM_POLICY),
    ('high', 'keyword_optimization', pipeline.STRICT_CLAIM_POLICY),
])
def test_writer_claim_policy_follows_aggressiveness(aggressiveness, operation, expected):
    doc = validate_resume_document(source_document())
    prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections[:1],
        generation_settings={'aggressiveness': aggressiveness, '_operation': operation},
        job_title='Engineer', company_name='Acme', job_description='Build APIs.', instructions=None, current=None, target_entry_id=None)
    assert expected in prompt[0][1]
    other = pipeline.STRICT_CLAIM_POLICY if expected == pipeline.HIGH_FIT_CLAIM_POLICY else pipeline.HIGH_FIT_CLAIM_POLICY
    assert other not in prompt[0][1]


def test_grounding_audit_prompt_is_plausibility_based_only_for_high():
    high = pipeline.grounding_audit_system_prompt('high')
    medium = pipeline.grounding_audit_system_prompt('medium')
    assert 'implausible_claim' in high and 'unsupported_date_or_tenure' in high and 'unsupported_employer' in high
    assert 'plausible for the cited role' in high
    assert 'supported by its cited source' in medium and 'plausible' not in medium


@pytest.mark.asyncio
async def test_high_keyword_audit_rejects_unsupported_technology_with_strict_policy(monkeypatch):
    doc = validate_resume_document(source_document())
    rewritten, view = pipeline.apply_keyword_patch(
        patch={'id': 'summary-id', 'paragraph': 'Built Python APIs using Kubernetes.', 'source_ids': ['summary-id']},
        source=doc.sections[0], current=doc.sections[0], document=doc, privacy_values=[],
    )
    assert 'Kubernetes' in rewritten.content_md  # Local citation checks cannot decide technology support.

    async def strict_audit(**kwargs):
        assert 'supported by its cited source' in kwargs['prompt'][0][1]
        assert 'plausible for the cited role' not in kwargs['prompt'][0][1]
        assert json.loads(kwargs['prompt'][1][1])['aggressiveness'] == 'medium'
        return pipeline.GroundingAudit(sections=[{'id': 'summary-id', 'supported': False, 'issues': ['unsupported_technology']}]), 'audit'

    monkeypatch.setattr(pipeline, 'call_with_fallback', strict_audit)
    result = await pipeline.audit_section_grounding(sections=[view], source=doc,
        generation_settings={'aggressiveness': 'high', '_operation': 'keyword_optimization'},
        model='audit', api_key='test', base_url='https://provider.invalid', budget=pipeline.CallBudget.for_seconds(5))
    assert result == {'summary-id': 'unsupported_technology'}
    prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections[:2],
        generation_settings={'aggressiveness': 'high', '_operation': 'keyword_optimization'},
        job_title='Engineer', company_name='Acme', job_description='Kubernetes', instructions=None, current=doc, target_entry_id=None)
    human = json.loads(prompt[1][1])
    assert 'plausible' not in json.dumps(human['aggressiveness_contract'])
    assert human['title_policy'] == 'Preserve current titles exactly.'


def test_high_section_rules_allow_plausible_metrics_but_keyword_rules_stay_strict():
    doc = validate_resume_document(source_document())
    prompt = pipeline.build_section_prompt(source=doc, requested=doc.sections,
        generation_settings={'aggressiveness': 'high'}, job_title='Engineer', company_name='Acme',
        job_description='Build APIs.', instructions=None, current=None, target_entry_id=None)
    rule = json.loads(prompt[1][1])['section_rules']['professional_experience']
    assert 'do not invent metrics or scope' not in rule
    assert 'High claim policy' in rule


def test_skills_may_cite_experience_bullets_and_summary_cites_its_own_source():
    doc = validate_resume_document(source_document())
    texts = pipeline._source_texts(doc)
    assert pipeline._paragraph_references('skills', 'skills-id', ['bullet-two'], texts) == ['bullet-two']
    assert pipeline._paragraph_references('summary', 'summary-id', ['bullet-one'], texts) == ['bullet-one', 'summary-id']
    with pytest.raises(pipeline.SectionValidationError, match='cross_section_source_reference'):
        pipeline._paragraph_references('custom', 'custom-id', ['bullet-one'], texts)


def test_summary_restating_source_summary_fact_passes_when_only_experience_is_cited():
    source = source_document()
    source['sections'][0]['content_md'] = 'Backend engineer with 10+ years building Python APIs.'
    doc = validate_resume_document(source)
    rendered = pipeline.apply_section_rewrite(source=doc.sections[0], rewrite={
        'id': 'summary-id', 'paragraph': 'Backend engineer with 10+ years of Python API work and 35% lower latency.',
        'source_ids': ['bullet-one'], 'entries': []}, document=doc, aggressiveness='medium')
    assert rendered.source_ids == ['bullet-one', 'summary-id']


def _jev_answers(decisions):
    """decisions: claim text substring -> p_pass; unmatched claims pass confidently."""
    import jev_audit
    async def decide(claims, level, **_kwargs):
        result = {}
        for claim in claims:
            p = next((value for key, value in decisions.items() if key in claim.text), 0.97)
            options = jev_audit.options_for(level)
            probabilities = {key: 0.0 for key in options}
            probabilities[jev_audit.PASS_OPTION[level]] = p
            failure = 'unsupported_metric' if level == 'medium' else 'implausible_claim'
            probabilities[failure] = round(1 - p, 6)
            result[claim.id] = jev_audit.JevAnswer.model_validate({'type': 'choice', 'choice': max(probabilities, key=probabilities.get),
                'confidence': max(probabilities.values()), 'probabilities': probabilities})
        return result
    return decide


async def _jev_audit(monkeypatch, decisions, *, llm_supported=True, jev_raises=False):
    import jev_audit
    llm_calls = []
    async def llm(**kwargs):
        kwargs['budget'].requests += 1
        payload = json.loads(kwargs['prompt'][1][1])
        llm_calls.append(payload['sections_to_verify'])
        return pipeline.GroundingAudit(sections=[{'id': s['id'], 'supported': llm_supported,
            'issues': [] if llm_supported else ['unsupported_scope']} for s in payload['sections_to_verify']])
    async def unavailable(*_args, **_kwargs):
        raise jev_audit.JevUnavailable('down')
    monkeypatch.setattr(pipeline, 'structured_call', llm)
    monkeypatch.setattr(pipeline.jev_audit, 'decide', unavailable if jev_raises else _jev_answers(decisions))
    doc = validate_resume_document(source_document())
    sections = [doc.sections[0], doc.sections[1]]
    budget = pipeline.CallBudget.for_seconds(10, max_requests=4)
    result = await pipeline.audit_section_grounding(sections=sections, source=doc,
        generation_settings={'aggressiveness': 'medium', '_jev_audit_model': 'typesafe/jev-1.13'},
        model='tier1', fallback_model='tier2', api_key='test', base_url='https://provider.invalid/v1', budget=budget)
    return result, llm_calls, budget


@pytest.mark.asyncio
async def test_jev_confident_passes_need_no_llm_call_or_request_budget(monkeypatch):
    result, llm_calls, budget = await _jev_audit(monkeypatch, {})
    assert result == {} and llm_calls == [] and budget.requests == 0
    assert budget.attempts[-1]['operation'] == 'jev_audit' and budget.attempts[-1]['outcome'] == 'success'


@pytest.mark.asyncio
async def test_jev_confident_failure_rejects_section_with_issue_code(monkeypatch):
    result, llm_calls, _ = await _jev_audit(monkeypatch, {'35%': 0.03})
    assert result == {'experience-id': 'unsupported_metric'} and llm_calls == []


@pytest.mark.asyncio
async def test_jev_uncertain_claim_escalates_only_that_claim_to_llm(monkeypatch):
    result, llm_calls, budget = await _jev_audit(monkeypatch, {'Maintained FastAPI': 0.5}, llm_supported=False)
    assert result == {'experience-id': 'unsupported_scope'}
    escalated = llm_calls[0]
    assert [s['id'] for s in escalated] == ['experience-id']
    bullets = [b['text'] for e in escalated[0]['entries'] for b in e['bullets']]
    assert bullets == ['Maintained FastAPI services.']
    assert budget.requests == 1


@pytest.mark.asyncio
async def test_jev_unavailable_falls_back_to_full_llm_audit(monkeypatch):
    result, llm_calls, budget = await _jev_audit(monkeypatch, {}, jev_raises=True)
    assert result == {} and [s['id'] for s in llm_calls[0]] == ['summary-id', 'experience-id']
    assert budget.attempts[0]['outcome'] == 'failed' and budget.attempts[0]['error_type'] == 'JevUnavailable'


@pytest.mark.asyncio
async def test_writer_groups_run_concurrently_and_one_failed_group_keeps_the_other(monkeypatch):
    import asyncio
    started, writes = [], []
    async def call(**kwargs):
        payload = json.loads(kwargs['prompt'][1][1])
        if kwargs['output_type'] is pipeline.GroundingAudit:
            return pipeline.GroundingAudit(sections=[{'id': s['id'], 'supported': True, 'issues': []} for s in payload['sections_to_verify']])
        ids = requested_ids(kwargs)
        started.append(ids)
        await asyncio.sleep(0.01)
        writes.append(ids)
        if ids == ['experience-id'] and len([w for w in writes if w == ['experience-id']]) == 1 and kwargs['operation'] == 'section_generation':
            raise RuntimeError('Synthetic experience transport failure')
        outputs = {'summary-id': summary_output(), 'experience-id': experience_output(), 'custom-id': custom_output()}
        return pipeline.SectionBatch.model_validate({'sections': [outputs[i] for i in ids]})
    monkeypatch.setattr(pipeline, 'structured_call', call)
    result = await _generate(monkeypatch, call)
    # Both round-0 groups start before either finishes; the failed Experience group is repaired alone.
    assert started[:2] == [['experience-id'], ['summary-id', 'custom-id']] and writes[0] == ['experience-id']
    assert started.count(['summary-id', 'custom-id']) == 1
    assert result['document']['sections'][0]['content_md'] == summary_output()['paragraph']
    assert 'diagnostics' in result and isinstance(result['diagnostics']['summary_experience_overlaps'], int)


def test_writer_groups_split_experience_from_other_sections():
    doc = validate_resume_document(source_document())
    groups = pipeline._writer_groups([doc.sections[0], doc.sections[1], doc.sections[3]])
    assert [[s.id for s in group] for group in groups] == [['experience-id'], ['summary-id', 'custom-id']]
    assert [[s.id for s in group] for group in pipeline._writer_groups([doc.sections[0]])] == [['summary-id']]


@pytest.mark.asyncio
async def test_every_writable_section_failing_still_fails_the_generation(monkeypatch):
    with pytest.raises(pipeline.SectionGenerationError):
        await run_pipeline(monkeypatch, [{'sections': []}, {'sections': []}, {'sections': []}])


@pytest.mark.asyncio
async def test_targeted_section_regeneration_does_not_keep_original_on_failure(monkeypatch):
    current = validate_resume_document(source_document()).model_dump(mode='json')
    with pytest.raises(pipeline.SectionGenerationError):
        await run_pipeline(monkeypatch, [{'sections': []}, {'sections': []}, {'sections': []}],
            generation_settings={'_current_document': current}, target_section_id='summary-id', instructions='Tighten it.')


def _generated_like_document():
    """The source as a writer would return it: every prose section and bullet cites its source."""
    doc = validate_resume_document(source_document())
    for section in doc.sections:
        if not section.entries:
            section.source_ids = [section.id]
        for entry in section.entries:
            for bullet in entry.bullets:
                bullet.source_ids = [bullet.id]
    return doc


def test_kept_original_must_match_source_exactly_to_revalidate():
    doc = _generated_like_document()
    kept = pipeline.keep_original_sections(doc, {'summary-id'}, source=doc, current=None)
    sections = pipeline.document_sections(kept)
    ids = [section['name'] for section in sections]
    assert pipeline.validate_document_sections(generated_sections=sections, source_payload=source_document(),
        generation_settings={}, expected_ids=ids)['valid']
    tampered = kept.model_copy(deep=True)
    tampered.sections[0].content_md = 'Invented summary text.'
    sections = pipeline.document_sections(tampered)
    checked = pipeline.validate_document_sections(generated_sections=sections, source_payload=source_document(),
        generation_settings={}, expected_ids=ids)
    assert not checked['valid'] and checked['errors'][0]['type'] == 'kept_original_changed'


def test_worker_revalidation_fallback_keeps_only_failed_sections():
    doc = _generated_like_document()
    ids = [section['name'] for section in pipeline.document_sections(doc)]
    fixed = pipeline.keep_original_for_invalid_sections(document_payload=doc.model_dump(mode='json'),
        validation_errors=[{'section': 'summary-id', 'type': 'unsupported_numeric_fact'}],
        generation_settings={'_source_document': source_document()}, operation='generation', expected_ids=ids)
    assert fixed and fixed['validation']['valid']
    assert [s['id'] for s in fixed['document']['sections'] if s['generation_notice']] == ['summary-id']
    assert pipeline.keep_original_for_invalid_sections(document_payload=doc.model_dump(mode='json'),
        validation_errors=[{'type': 'section_identity_or_order'}], generation_settings={'_source_document': source_document()},
        operation='generation', expected_ids=ids) is None


@pytest.mark.asyncio
async def test_verified_sections_are_reported_per_group_as_they_finish(monkeypatch):
    ready = []
    async def on_ready(sections):
        ready.append([section.id for section in sections])
    invalid = experience_output()
    invalid['entries'][0]['bullets'][0]['text'] = 'Improved latency by 99%.'
    result, _ = await run_pipeline(monkeypatch, [
        {'sections': [summary_output(), invalid, custom_output()]},
        {'sections': [experience_output()]},
    ], on_sections_ready=on_ready)
    # Summary/custom are reported as soon as their group passes; Experience after its repair.
    assert ready == [['summary-id', 'custom-id'], ['experience-id']]
    assert result['document']


@pytest.mark.parametrize('text,flagged', [
    ('Built a regression suite across a multi-application client portfolio. Manual cycles shrank to hours.', False),
    ('Maintained the product portfolio.', False),
    ('See portfolio.janedoe.dev for samples.', True),
    ('Profile at github.com/janedoe.', True),
])
def test_sentence_ending_in_portfolio_is_not_a_profile_url(text, flagged):
    if flagged:
        with pytest.raises(pipeline.SectionValidationError, match='contact_information_profile_url'):
            pipeline._check_privacy(text)
    else:
        pipeline._check_privacy(text)


@pytest.mark.asyncio
async def test_jev_requests_never_contain_profile_values(monkeypatch):
    sent = []
    async def capture(claims, level, **_kwargs):
        sent.extend(claims)
        return await _jev_answers({})(claims, level)
    monkeypatch.setattr(pipeline.jev_audit, 'decide', capture)
    source = source_document()
    source['sections'][0]['content_md'] = 'Alex Example built Python APIs.'
    doc = validate_resume_document(source)
    section = doc.sections[0].model_copy(deep=True)
    section.content_md = 'Alex Example built Python APIs.'
    section.source_ids = ['summary-id']
    await pipeline.audit_section_grounding(sections=[section], source=doc,
        generation_settings={'aggressiveness': 'medium', '_jev_audit_model': 'typesafe/jev-1.13', '_privacy_values': ['Alex Example']},
        model='tier1', fallback_model='tier2', api_key='test', base_url='https://provider.invalid/v1',
        budget=pipeline.CallBudget.for_seconds(10))
    assert sent and all('Alex Example' not in f'{c.text} {c.evidence} {c.role}' for c in sent)


def test_applied_rewrite_clears_a_kept_original_notice():
    doc = validate_resume_document(source_document())
    current = doc.sections[1].model_copy(deep=True)
    current.generation_notice = 'kept_original_unverified'
    rendered = pipeline.apply_section_rewrite(source=doc.sections[1], rewrite=experience_output(target_entry=True),
        document=doc, aggressiveness='medium', target_entry_id='role-one', current=current)
    assert rendered.generation_notice is None


@pytest.mark.asyncio
async def test_unfinished_length_reduction_fails_instead_of_keeping_longer_original(monkeypatch):
    oversized = summary_output()
    oversized['paragraph'] = 'Python ' * 860
    with pytest.raises(pipeline.SectionGenerationError, match='draft_above_word_hard_cap'):
        await run_pipeline(monkeypatch, [
            {'sections': [deepcopy(oversized), experience_output(), custom_output()]},
            {'sections': [deepcopy(oversized)]},
            {'sections': [deepcopy(oversized)]},
        ])
