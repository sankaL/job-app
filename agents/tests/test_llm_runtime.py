from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel

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
    mock_provider(monkeypatch, [{'count':7}])
    await structured_call(prompt=[('system','Private instructions'),('human','Sensitive resume text alex@example.com')],
        output_type=ExampleOutput,model_name='test/provider',api_key='secret-key',base_url='https://provider.invalid/v1',
        budget=CallBudget.for_seconds(3),operation='section_grounding_audit')
    assert captures[0]['run_type']=='llm'
    assert captures[0]['metadata']['operation']=='section_grounding_audit'
    assert captures[1]['outputs']['request_count']==1
    assert captures[1]['outputs']['output_tokens']==8
    assert 'Sensitive resume text' not in str(captures)
    assert 'alex@example.com' not in str(captures)
    assert 'secret-key' not in str(captures)


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
