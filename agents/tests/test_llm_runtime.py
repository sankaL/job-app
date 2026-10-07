from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel, ConfigDict, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from llm_runtime import CallBudget, structured_call


class ExampleOutput(BaseModel):
    count: int


def mock_provider(monkeypatch, outputs):
    import openai
    original_client = openai.AsyncOpenAI
    requests = []

    async def respond(request):
        data = json.loads(request.content)
        requests.append(data)
        item = outputs.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, httpx.Response):
            return item
        if 'tools' not in data:
            return httpx.Response(200, json={
                'id':'test-completion','object':'chat.completion','created':1,'provider':'Synthetic','model':data['model'],
                'choices':[{'index':0,'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(item)}}],
                'usage':{'prompt_tokens':12,'completion_tokens':8,'total_tokens':20}})
        name = data['tools'][0]['function']['name']
        return httpx.Response(200, json={
            'id': 'test-completion', 'object': 'chat.completion', 'created': 1,
            'model': data['model'], 'provider': 'Synthetic',
            'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {
                'role': 'assistant', 'content': None,
                'tool_calls': [{'id': 'call-test', 'type': 'function', 'function': {
                    'name': name, 'arguments': json.dumps(item),
                }}],
            }}],
            'usage': {'prompt_tokens': 12, 'completion_tokens': 8, 'total_tokens': 20},
        })

    def factory(**kwargs):
        return original_client(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))

    monkeypatch.setattr(openai, 'AsyncOpenAI', factory)
    return requests


@pytest.mark.asyncio
@pytest.mark.parametrize('batch_name,bullet_type', [('SectionBatch','RewrittenBullet'), ('KeywordSectionBatch','KeywordBulletPatch')])
async def test_real_provider_tools_receive_full_section_schemas_without_discarding_siblings(monkeypatch, batch_name, bullet_type):
    import section_generation
    batch_type = getattr(section_generation, batch_name)
    malformed = {'id': 'section-id', 'unexpected_field': 'Must be checked locally'}
    requests = mock_provider(monkeypatch, [{'sections': [malformed]}])
    budget = CallBudget.for_seconds(3, max_requests=2)
    output = await structured_call(prompt=[('human','Return requested sections.')], output_type=batch_type,
        model_name='test/primary', api_key='test', base_url='https://provider.invalid/v1', budget=budget)
    assert output.sections == [malformed]
    assert len(requests) == 1
    schema = requests[0]['tools'][0]['function']['parameters']
    assert set(schema['properties']['sections']['items']['properties']) == {'id', 'paragraph', 'source_ids', 'entries'}
    assert schema['$defs'][bullet_type]['additionalProperties'] is False
    assert 'text' in schema['$defs'][bullet_type]['properties']
    assert ('id' in schema['$defs'][bullet_type]['properties']) == (batch_name == 'KeywordSectionBatch')


@pytest.mark.asyncio
@pytest.mark.parametrize('model_name', ['google/gemini-3.7-flash', 'test/provider'])
async def test_runtime_disables_profile_auto_strict_tools_but_keeps_nested_schema(monkeypatch, model_name):
    import section_generation
    requests = mock_provider(monkeypatch, [{'sections': []}])
    await structured_call(prompt=[('human','Return requested sections.')], output_type=section_generation.SectionBatch,
        model_name=model_name, api_key='test', base_url='https://provider.invalid/v1', budget=CallBudget.for_seconds(3))
    function = requests[0]['tools'][0]['function']
    assert function.get('strict', False) is False
    assert set(function['parameters']['properties']['sections']['items']['properties']) == {'id','paragraph','source_ids','entries'}


@pytest.mark.asyncio
@pytest.mark.parametrize('batch_name', ['SectionBatch','KeywordSectionBatch'])
async def test_google_function_transport_keeps_nested_shape_and_removes_unsupported_constraints(monkeypatch, batch_name):
    import section_generation
    requests = mock_provider(monkeypatch, [{'sections': []}])
    await structured_call(prompt=[('human','Return requested sections.')], output_type=getattr(section_generation,batch_name),
        model_name='~google/gemini-3.7-flash', api_key='test', base_url='https://provider.invalid/v1', budget=CallBudget.for_seconds(3))
    schema = requests[0]['tools'][0]['function']['parameters']
    allowed = {'type','nullable','required','format','description','properties','items','enum','anyOf','$ref','$defs'}
    def check(node):
        assert set(node) <= allowed
        if node.get('type') == 'array':
            assert 'items' in node
        for child in node.get('properties',{}).values():
            check(child)
        if isinstance(node.get('items'),dict):
            check(node['items'])
        for child in node.get('anyOf',[]):
            check(child)
    check(schema)
    section = schema['properties']['sections']['items']
    assert section['type'] == 'object'
    assert section['required'] == ['id']
    assert section['properties']['id']['type'] == 'string'
    assert section['properties']['entries']['items']['properties']['id']['type'] == 'string'
    nullable = section['properties']['entries']['items']['properties']['title'] if batch_name == 'SectionBatch' else section['properties']['paragraph']
    assert nullable['type'] == 'string'
    assert nullable['nullable'] is True


@pytest.mark.asyncio
async def test_google_transport_omissions_keep_strict_local_output_correction(monkeypatch):
    class ConstrainedOutput(BaseModel):
        model_config = ConfigDict(extra='forbid',strict=True)
        label: str = Field(min_length=2,max_length=4)
        values: list[int] = Field(min_length=1,max_length=2)
    requests = mock_provider(monkeypatch, [
        {'label':'oversized','values':[],'extra':'forbidden'},
        {'label':'good','values':[1]},
    ])
    budget = CallBudget.for_seconds(3,max_requests=2)
    result = await structured_call(prompt=[('human','Return the requested typed value.')], output_type=ConstrainedOutput,
        model_name='google/gemini-3.7-flash',api_key='test',base_url='https://provider.invalid/v1',budget=budget)
    assert result.label == 'good'
    assert budget.requests == 2
    schema = requests[0]['tools'][0]['function']['parameters']
    assert 'additionalProperties' not in schema
    assert 'maxLength' not in schema['properties']['label']
    assert 'minItems' not in schema['properties']['values']
    assert any(message['role']=='tool' for message in requests[1]['messages'])


@pytest.mark.asyncio
async def test_provider_http_schema_error_reports_only_safe_category_status_and_flags(monkeypatch):
    from llm_runtime import AIRequestError
    secret = 'user@example.test private provider payload'
    requests = mock_provider(monkeypatch, [httpx.Response(400, json={'error': {
        'code':'invalid_json_schema', 'message':'Invalid schema: strict requires all properties in required; nullable default is unsupported.',
        'metadata': {'raw': secret},
    }})])
    budget = CallBudget.for_seconds(3, max_requests=1)
    with pytest.raises(AIRequestError) as result:
        await structured_call(prompt=[('human','Return a count.')], output_type=ExampleOutput,
            model_name='test/provider', api_key='test', base_url='https://provider.invalid/v1', budget=budget)
    assert len(requests) == 1
    attempt = budget.attempts[0]
    assert attempt['http_status'] == 400
    assert attempt['provider_error_category'] == 'strict_required'
    assert attempt['provider_error_code'] == 'invalid_json_schema'
    assert set(attempt['provider_schema_flags']) == {'strict','required','nullable','default','properties'}
    assert secret not in json.dumps(attempt)
    assert secret not in str(result.value)


@pytest.mark.parametrize('raw_is_json_string', [False, True])
def test_safe_http_classifier_reads_bounded_nested_upstream_details_and_lists(raw_is_json_string):
    from llm_runtime import safe_provider_error_details
    raw = {'error': {'message':'Invalid value at tools.function_declarations.parameters: cannot find enum value for null.',
        'details':[{'fieldViolations':[{'description':'Invalid parameters_json_schema type; private@example.test'}]}]}}
    if raw_is_json_string:
        raw = json.dumps(raw)
    report = safe_provider_error_details(400, {'error': {'message':'Provider returned error', 'metadata': {'raw':raw}}})
    assert report['provider_error_category'] == 'invalid_schema'
    assert {'function_declarations','parameters','type','enum','null','parameters_json_schema'} <= set(report['provider_schema_flags'])
    assert 'private@example.test' not in json.dumps(report)


def test_safe_http_classifier_bounds_cyclic_and_unhashable_error_payloads():
    from llm_runtime import safe_provider_error_details
    body = {'error': {'code': {'untrusted':'value'}, 'details': []}}
    body['error']['details'].append(body)
    report = safe_provider_error_details(400, body)
    assert report['provider_error_category'] == 'invalid_request'
    assert 'untrusted' not in json.dumps(report)


@pytest.mark.asyncio
async def test_real_pydantic_ai_runtime_corrects_schema_with_one_shared_request_budget(monkeypatch):
    requests = mock_provider(monkeypatch, [{'count': 'invalid'}, {'count': 2}, {'count': 3}])
    budget = CallBudget.for_seconds(3, max_requests=3)
    output = await structured_call(
        prompt=[('system', 'Return the requested typed value.'), ('human', 'Count things.')],
        output_type=ExampleOutput, model_name='test/provider', api_key='test',
        base_url='https://provider.invalid/v1', budget=budget,
    )
    assert output.count == 2
    assert budget.requests == 2
    assert budget.output_tokens == 16
    assert len(requests) == 2
    assert any(message['role'] == 'tool' for message in requests[1]['messages'])
    output = await structured_call(
        prompt=[('system', 'Return a count.'), ('human', 'Count again.')],
        output_type=ExampleOutput, model_name='test/fallback', api_key='test',
        base_url='https://provider.invalid/v1', budget=budget,
    )
    assert output.count == 3
    assert budget.requests == 3
    with pytest.raises(RuntimeError, match='usage budget'):
        await structured_call(
            prompt=[('human', 'No further request is allowed.')], output_type=ExampleOutput,
            model_name='test/fallback', api_key='test', base_url='https://provider.invalid/v1', budget=budget,
        )
    assert len(requests) == 3
    assert all('Count things' not in str(attempt) for attempt in budget.attempts)


@pytest.mark.asyncio
async def test_provider_transport_error_consumes_budget_without_hidden_sdk_retries(monkeypatch):
    requests = mock_provider(monkeypatch, [httpx.ConnectError('synthetic transport failure')])
    budget = CallBudget.for_seconds(3, max_requests=1)
    with pytest.raises(Exception):
        await structured_call(
            prompt=[('human', 'Count.')], output_type=ExampleOutput,
            model_name='test/provider', api_key='test', base_url='https://provider.invalid/v1', budget=budget,
        )
    assert len(requests) == 1
    assert budget.requests == 1
    assert 'synthetic transport failure' not in str(budget.attempts)


@pytest.mark.asyncio
async def test_runtime_enforces_deadline_and_cancels_inflight_request(monkeypatch):
    import openai
    original_client = openai.AsyncOpenAI
    cancelled = asyncio.Event()

    async def respond(request):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(openai, 'AsyncOpenAI', lambda **kwargs: original_client(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    ))
    budget = CallBudget.for_seconds(0.05, max_requests=2)
    with pytest.raises(asyncio.TimeoutError):
        await structured_call(
            prompt=[('human', 'Count.')], output_type=ExampleOutput,
            model_name='test/provider', api_key='test', base_url='https://provider.invalid/v1', budget=budget,
        )
    assert cancelled.is_set()
    assert budget.requests == 1


@pytest.mark.asyncio
async def test_model_trace_records_counts_without_raw_prompt_or_output(monkeypatch):
    from contextlib import contextmanager
    import llm_runtime
    captures = []
    class Trace:
        def end(self, **kwargs):
            captures.append(kwargs)
    @contextmanager
    def scoped(name, **kwargs):
        captures.append({'name':name, **kwargs})
        yield Trace()
    monkeypatch.setattr(llm_runtime, 'trace_scope', scoped)
    monkeypatch.setattr(llm_runtime, 'trace_content_enabled', lambda: False)
    mock_provider(monkeypatch, [{'count':7}])
    await structured_call(prompt=[('system','Private instructions'),('human','Sensitive resume text alex@example.com')],
        output_type=ExampleOutput,model_name='test/provider',api_key='secret-key',base_url='https://provider.invalid/v1',
        budget=CallBudget.for_seconds(3),operation='section_grounding_audit')
    assert captures[0]['run_type']=='llm'
    assert captures[0]['metadata']['operation']=='section_grounding_audit'
    assert captures[0]['metadata']['content_traced'] is False
    assert captures[1]['outputs']['request_count']==1
    assert captures[1]['outputs']['output_tokens']==8
    assert 'output' not in captures[1]['outputs']
    assert 'Sensitive resume text' not in str(captures)
    assert 'alex@example.com' not in str(captures)
    assert 'secret-key' not in str(captures)


@pytest.mark.asyncio
async def test_model_trace_includes_redacted_prompt_and_output_when_content_opted_in(monkeypatch):
    from contextlib import contextmanager
    import llm_runtime
    captures = []
    class Trace:
        def end(self, **kwargs):
            captures.append(kwargs)
    @contextmanager
    def scoped(name, **kwargs):
        captures.append({'name':name, **kwargs})
        yield Trace()
    monkeypatch.setattr(llm_runtime, 'trace_scope', scoped)
    monkeypatch.setattr(llm_runtime, 'trace_content_enabled', lambda: True)
    mock_provider(monkeypatch, [{'count':7}])
    await structured_call(prompt=[('system','Grounding instructions'),('human','Resume text alex@example.com')],
        output_type=ExampleOutput,model_name='test/provider',api_key='secret-key',base_url='https://provider.invalid/v1',
        budget=CallBudget.for_seconds(3),operation='section_grounding_audit')
    assert captures[0]['inputs']['messages'] == [
        {'role': 'system', 'content': 'Grounding instructions'},
        {'role': 'user', 'content': 'Resume text alex@example.com'},
    ]
    assert captures[0]['metadata']['content_traced'] is True
    assert captures[1]['outputs']['output'] == {'count': 7}
    assert 'secret-key' not in str(captures)


@pytest.mark.asyncio
@pytest.mark.parametrize('model_name,expected', [
    ('google/gemini-3.8-flash', {'output_mode': 'native', 'temperature': 'provider_default',
        'reasoning_effort': 'medium', 'reasoning_text_excluded': True}),
    ('anthropic/claude-sonnet-5.5', {'output_mode': 'native', 'reasoning_effort': 'capped',
        'reasoning_max_tokens': 2000, 'reasoning_text_excluded': True}),
    ('test/provider', {'output_mode': 'tool', 'temperature': 0.35,
        'reasoning_effort': 'high', 'reasoning_text_excluded': False}),
])
async def test_model_trace_metadata_describes_settings_actually_sent(monkeypatch, model_name, expected):
    from contextlib import contextmanager
    import llm_runtime
    captures = []
    @contextmanager
    def scoped(name, **kwargs):
        captures.append(kwargs)
        yield None
    monkeypatch.setattr(llm_runtime, 'trace_scope', scoped)
    mock_provider(monkeypatch, [{'count':7}])
    await structured_call(prompt=[('human','Count.')],output_type=ExampleOutput,model_name=model_name,api_key='test',
        base_url='https://provider.invalid/v1',budget=CallBudget.for_seconds(3),temperature=0.35,reasoning={'effort':'high'})
    metadata = captures[0]['metadata']
    assert {key: metadata[key] for key in expected} == expected
    assert metadata['output_type'] == 'ExampleOutput'
    assert metadata['max_tokens'] == 16000


@pytest.mark.asyncio
async def test_optional_trace_setup_failure_does_not_fail_provider_call(monkeypatch):
    import llm_runtime
    def unavailable(*args, **kwargs):
        raise RuntimeError('trace is unavailable')
    monkeypatch.setattr(llm_runtime,'trace_scope',unavailable)
    mock_provider(monkeypatch,[{'count':7}])
    result=await structured_call(prompt=[('human','Count.')],output_type=ExampleOutput,
        model_name='test/provider',api_key='test',base_url='https://provider.invalid/v1',budget=CallBudget.for_seconds(3))
    assert result.count==7


@pytest.mark.asyncio
# Claude Haiku 5.5 is newer than the pinned SDK's JSON-schema allowlist; the config's native_json mode must still apply.
@pytest.mark.parametrize('model_name', ['anthropic/claude-sonnet-5.5','anthropic/claude-haiku-5.5','openai/gpt-6.1-sol','google/gemini-3.8-flash','openai/gpt-6-luna'])
async def test_current_models_use_native_json_default_reasoning_and_bounded_correction(monkeypatch, model_name):
    import llm_runtime
    requests = mock_provider(monkeypatch, [{'count':'invalid'}, {'count':2}])
    budget = CallBudget.for_seconds(3,max_requests=2)
    output = await structured_call(prompt=[('human','Return count 2.')],output_type=ExampleOutput,
        model_name=model_name,api_key='test',base_url='https://provider.invalid/v1',budget=budget,
        reasoning={'effort':'none'})
    assert output.count == 2
    assert budget.requests == len(requests) == 2
    for request in requests:
        assert request['response_format']['type'] == 'json_schema'
        assert 'tools' not in request and 'tool_choice' not in request
        assert 'temperature' not in request
        # Native models use bounded per-family reasoning; the caller's effort is ignored.
        assert request['reasoning'] == llm_runtime.reasoning_settings_for(model_name)


@pytest.mark.asyncio
async def test_authentication_failure_is_not_eligible_for_model_fallback(monkeypatch):
    from llm_runtime import AIRequestError
    mock_provider(monkeypatch,[httpx.Response(401,json={'error':{'message':'Invalid credentials'}})])
    with pytest.raises(AIRequestError) as caught:
        await structured_call(prompt=[('human','Return count.')],output_type=ExampleOutput,
            model_name='test/primary',api_key='test',base_url='https://provider.invalid/v1',budget=CallBudget.for_seconds(3))
    assert caught.value.can_fallback is False


@pytest.mark.asyncio
async def test_adapter_preserves_fallback_trace_metadata(monkeypatch):
    from contextlib import contextmanager
    import llm_runtime
    captures = []
    @contextmanager
    def scoped(name, **kwargs):
        captures.append(kwargs)
        yield None
    monkeypatch.setattr(llm_runtime, "trace_scope", scoped)
    mock_provider(monkeypatch, [{"count": 7}])
    adapter = llm_runtime.StructuredLLM(model="test/fallback", api_key="test",
        base_url="https://provider.invalid/v1", request_timeout=3)
    await adapter.with_structured_output(ExampleOutput).ainvoke([("human", "Count.")],
        config={"metadata": {"operation": "resume_judge", "is_fallback": True}})
    assert captures[0]["metadata"]["is_fallback"] is True
    assert captures[0]["metadata"]["operation"] == "resume_judge"


@pytest.mark.asyncio
async def test_trace_output_failure_keeps_result_and_closes_client(monkeypatch):
    from contextlib import contextmanager
    import openai
    import llm_runtime
    captures = []
    closed = []
    class Trace:
        def end(self, **kwargs):
            captures.append(kwargs)
    @contextmanager
    def scoped(name, **kwargs):
        yield Trace()
    def broken(_value):
        raise RuntimeError('serialization failed')
    monkeypatch.setattr(llm_runtime, 'trace_scope', scoped)
    monkeypatch.setattr(llm_runtime, 'trace_content_enabled', lambda: True)
    monkeypatch.setattr(llm_runtime, 'sanitize_trace_data', broken)
    original_close = openai.AsyncOpenAI.close
    async def close(self):
        closed.append(True)
        await original_close(self)
    monkeypatch.setattr(openai.AsyncOpenAI, 'close', close)
    mock_provider(monkeypatch, [{'count':7}])
    result = await structured_call(prompt=[('human','Count.')],output_type=ExampleOutput,model_name='test/provider',
        api_key='test',base_url='https://provider.invalid/v1',budget=CallBudget.for_seconds(3))
    assert result.count == 7
    assert closed == [True]
    assert captures[0]['outputs']['output'] == '<unavailable>'


def test_budget_errors_keep_compatible_base_types_and_affordability():
    from llm_runtime import AIBudgetExhausted, AIDeadlineReached
    budget = CallBudget.for_seconds(5, max_requests=3)
    budget.requests = 2
    assert budget.can_afford(1) is True
    assert budget.can_afford(2) is False
    budget.requests = 3
    with pytest.raises(AIBudgetExhausted) as raised:
        budget.remaining_seconds()
    assert isinstance(raised.value, RuntimeError)
    expired = CallBudget(deadline=0)
    assert expired.can_afford(1) is False
    with pytest.raises(asyncio.TimeoutError):
        expired.remaining_seconds()
    assert issubclass(AIDeadlineReached, asyncio.TimeoutError)


@pytest.mark.asyncio
async def test_failed_model_run_is_marked_as_error_with_fixed_label(monkeypatch):
    from contextlib import contextmanager
    import llm_runtime
    from llm_runtime import AIRequestError
    captures = []
    class Trace:
        def end(self, **kwargs):
            captures.append(kwargs)
    @contextmanager
    def scoped(name, **kwargs):
        yield Trace()
    monkeypatch.setattr(llm_runtime, 'trace_scope', scoped)
    mock_provider(monkeypatch, [httpx.Response(503, json={'error': {'message': 'Private upstream body'}})])
    with pytest.raises(AIRequestError):
        await structured_call(prompt=[('human','Count.')],output_type=ExampleOutput,model_name='test/provider',
            api_key='test',base_url='https://provider.invalid/v1',budget=CallBudget.for_seconds(3))
    assert captures[0]['error'] == 'ModelHTTPError: provider_unavailable'
    assert captures[0]['outputs']['outcome'] == 'failed'
    assert 'Private upstream' not in str(captures)


@pytest.mark.asyncio
@pytest.mark.parametrize('model_name,pinned', [('google/gemini-3.8-flash', ['google-ai-studio']), ('anthropic/claude-sonnet-5.5', None), ('openai/gpt-6-luna', None)])
async def test_requests_deny_data_retention_route_by_latency_and_record_served_provider(monkeypatch, model_name, pinned):
    requests = mock_provider(monkeypatch, [{'count': 3}])
    budget = CallBudget.for_seconds(3)
    await structured_call(prompt=[('human', 'Count.')], output_type=ExampleOutput, model_name=model_name, api_key='test',
        base_url='https://provider.invalid/v1', budget=budget)
    provider = requests[0]['provider']
    assert provider['data_collection'] == 'deny' and provider['require_parameters'] is True and provider['sort'] == 'latency'
    assert provider.get('only') == pinned
    assert budget.attempts[-1]['served_provider'] == 'Synthetic'


@pytest.mark.asyncio
@pytest.mark.parametrize('model_name,cached', [('anthropic/claude-sonnet-5.5', True), ('openai/gpt-6-luna', False)])
async def test_cache_split_marks_stable_prefix_only_for_cache_capable_providers(monkeypatch, model_name, cached):
    requests = mock_provider(monkeypatch, [{'count': 1}])
    payload = {'operation': 'generation', 'reviewed_source': {'sections': []}, 'requested_sections': [{'id': 'a'}]}
    await structured_call(prompt=[('system', 'Rules.'), ('human', json.dumps(payload))], output_type=ExampleOutput,
        model_name=model_name, api_key='test', base_url='https://provider.invalid/v1', budget=CallBudget.for_seconds(3),
        cache_stable_keys=('operation', 'reviewed_source'))
    user = next(message for message in requests[0]['messages'] if message['role'] == 'user')
    parts = user['content']
    assert json.loads(parts[0]['text']) == {'operation': 'generation', 'reviewed_source': {'sections': []}}
    assert json.loads(parts[1]['text']) == {'requested_sections': [{'id': 'a'}]}
    assert ('cache_control' in parts[0]) is cached
