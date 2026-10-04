from __future__ import annotations

from contextlib import asynccontextmanager
from copy import deepcopy
import json

import httpx
import pytest
from pydantic import BaseModel

from app.services.import_ai import invoke_import_output
from app.services.resume_document import ResumeSection
from app.services.resume_parser import ResumeParserService


class ImportOutput(BaseModel):
    value: int


@asynccontextmanager
async def mock_import_provider(monkeypatch, outputs, requests):
    import openai
    original_client = openai.AsyncOpenAI

    async def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if 'tools' not in payload:
            return httpx.Response(200,json={'id':'synthetic','object':'chat.completion','created':1,'provider':'Synthetic','model':payload['model'],
                'choices':[{'index':0,'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(outputs.pop(0))}}],
                'usage':{'prompt_tokens':12,'completion_tokens':8,'total_tokens':20}})
        assert all(tool["function"].get("strict") is not True for tool in payload["tools"])
        name = payload["tools"][0]["function"]["name"]
        return httpx.Response(200, json={
            "id": "synthetic-completion", "object": "chat.completion", "created": 1,
            "model": payload["model"], "provider": "Synthetic",
            "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "synthetic-call", "type": "function", "function": {
                    "name": name, "arguments": json.dumps(outputs.pop(0)),
                }}],
            }}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http_client:
        def client(**kwargs):
            assert kwargs["max_retries"] == 0
            return original_client(**{**kwargs, "http_client": http_client})

        monkeypatch.setattr("openai.AsyncOpenAI", client)
        yield


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_output", ["type", "extra_key", "invented_fact", "omitted_fact"])
@pytest.mark.parametrize("model_name", ["~google/gemini-3-flash-preview", "openai/gpt-4o-mini", "google/gemini-3.8-flash", "openai/gpt-6-luna"])
async def test_real_import_transport_exposes_fields_and_spans_with_local_corrections(monkeypatch, invalid_output, model_name):
    valid = {"sections": [{"section_id": "experience", "entries": [{
        "source_start_line": 1, "source_end_line": 4,
        "fields": {"company": "Acme", "title": "Engineer", "date_range": "2020 - 2024"},
        "bullets": [{"source_start_line": 4, "source_end_line": 4}],
    }]}]}
    invalid = deepcopy(valid)
    entry = invalid["sections"][0]["entries"][0]
    if invalid_output == "type":
        entry["fields"]["company"] = 12
    elif invalid_output == "extra_key":
        entry["employer"] = "Acme"
    elif invalid_output == "invented_fact":
        entry["fields"]["company"] = "Invented employer"
    else:
        entry["bullets"] = []
    source = ResumeSection(id="experience", kind="professional_experience", heading="Experience",
        content_md="Acme\nEngineer\n2020 - 2024\n- Built C++ APIs with +20.5% lower latency.")
    requests = []
    async with mock_import_provider(monkeypatch, [invalid, valid], requests):
        await ResumeParserService(openrouter_api_key="test-only", openrouter_model=model_name,
            openrouter_base_url="https://provider.invalid/v1")._extract_nested_entries([source], timeout_seconds=3)
    assert len(requests) == 2
    schema = requests[0]["tools"][0]["function"]["parameters"] if "tools" in requests[0] else requests[0]["response_format"]["json_schema"]["schema"]
    if model_name.removeprefix("~").startswith("google/"):
        imported_entry = schema["properties"]["sections"]["items"]["properties"]["entries"]["items"]
        def check_nodes(node):
            assert not {"default", "title", "additionalProperties", "minLength", "maxLength", "minItems", "maxItems"}.intersection(node)
            for child in node.get("properties", {}).values():
                check_nodes(child)
            if "items" in node:
                check_nodes(node["items"])
            for child in node.get("anyOf", []):
                check_nodes(child)
        check_nodes(schema)
        assert "additionalProperties" not in imported_entry["properties"]["fields"]
    else:
        imported_entry = schema["$defs"]["ImportedEntry"]
        assert imported_entry["additionalProperties"] is False
        assert len(imported_entry["properties"]["fields"]["anyOf"]) == 2
    assert set(imported_entry["properties"]) == {"fields", "bullets", "source_start_line", "source_end_line"}
    assert "anyOf" in imported_entry["properties"]["fields"]
    assert source.entries[0].fields == {"location": "", **valid["sections"][0]["entries"][0]["fields"]}
    assert source.entries[0].bullets[0].text == "Built C++ APIs with +20.5% lower latency."
    assert "items" in imported_entry["properties"]["bullets"]
    correction_role = "tool" if "tools" in requests[0] else "user"
    assert requests[1]["messages"][-1]["role"] == correction_role
    assert "Fix the errors" in requests[1]["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_real_cleanup_transport_still_repairs_changed_source_facts(monkeypatch):
    valid = {"cleaned_markdown": "## Summary\nBuilt C++ APIs with +20.5% lower latency.", "needs_review": False, "review_reason": None}
    invalid = {**valid, "cleaned_markdown": "## Summary\nBuilt C++ APIs with +95% lower latency."}
    requests = []
    async with mock_import_provider(monkeypatch, [invalid, valid], requests):
        result = await ResumeParserService(openrouter_api_key="test-only", openrouter_model="google/gemini-3-flash-preview",
            openrouter_base_url="https://provider.invalid/v1").cleanup_with_llm(valid["cleaned_markdown"], timeout_seconds=3)
    assert len(requests) == 2
    assert result.cleaned_markdown == valid["cleaned_markdown"] + "\n"
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_pydantic_ai_corrects_invalid_import_output_with_one_bounded_retry(monkeypatch):
    import openai
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    calls = []
    clients = []
    original_client = openai.AsyncOpenAI

    def capture_client(**kwargs):
        clients.append(kwargs)
        return original_client(**kwargs)

    def response(_messages, info):
        calls.append(info)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"value": 0 if len(calls) == 1 else 2})])

    monkeypatch.setattr("openai.AsyncOpenAI", capture_client)
    monkeypatch.setattr("pydantic_ai.models.openrouter.OpenRouterModel", lambda *_args, **_kwargs: FunctionModel(response))

    def validate(output):
        if output.value != 2:
            raise ValueError("Return the required factual value.")

    output = await invoke_import_output(api_key="test-key", base_url="https://openrouter.ai/api/v1", model="test-model", system_prompt="Extract fields.", user_prompt="source", output_type=ImportOutput, timeout_seconds=1.0, validator=validate)
    assert output.value == 2
    assert len(calls) == 2
    assert clients[0]["max_retries"] == 0


@pytest.mark.asyncio
async def test_pydantic_ai_does_not_loop_on_permanently_invalid_import(monkeypatch):
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    calls = []

    def response(_messages, info):
        calls.append(info)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"value": "invalid"})])

    monkeypatch.setattr("pydantic_ai.models.openrouter.OpenRouterModel", lambda *_args, **_kwargs: FunctionModel(response))
    with pytest.raises(UnexpectedModelBehavior):
        await invoke_import_output(api_key="test-key", base_url="https://openrouter.ai/api/v1", model="test-model", system_prompt="Extract fields.", user_prompt="source", output_type=ImportOutput, timeout_seconds=1.0)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_import_traces_corrections_usage_and_fallback_without_private_bodies(monkeypatch):
    from contextlib import contextmanager
    from app.core.tracing import TraceConfig
    from pydantic_ai.messages import ModelResponse, ToolCallPart, RequestUsage
    from pydantic_ai.models.function import FunctionModel

    captured = []
    calls = []
    class Run:
        def end(self, **kwargs):
            captured.append(kwargs)
    @contextmanager
    def scope(**kwargs):
        captured.append(kwargs)
        yield Run()
    def response(_messages, info):
        calls.append(info)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"value": "invalid" if len(calls) == 1 else 2})],
            usage=RequestUsage(input_tokens=12, output_tokens=8))
    monkeypatch.setattr("app.services.import_ai.trace_llm_scope", scope)
    monkeypatch.setattr("pydantic_ai.models.openrouter.OpenRouterModel", lambda *_args, **_kwargs: FunctionModel(response))
    result = await invoke_import_output(api_key="provider-secret", base_url="https://provider.invalid/v1",
        model="fallback-model", system_prompt="Private formatting rules", user_prompt="Private resume user@example.test",
        output_type=ImportOutput, timeout_seconds=2,
        trace_config=TraceConfig(enabled=True, api_key="telemetry-key", project_name="test-project"),
        operation="resume_entry_extraction", is_fallback=True)
    assert result.value == 2
    assert captured[0]["project_name"] == "test-project"
    assert captured[0]["metadata"]["is_fallback"] is True
    assert captured[0]["name"] == "applix.resume_entry_extraction.pydantic_ai"
    assert captured[1]["outputs"]["request_count"] == 2
    assert captured[1]["outputs"]["input_tokens"] == 24
    assert captured[1]["outputs"]["output_tokens"] == 16
    assert "Private resume" not in str(captured)
    assert "Private formatting" not in str(captured)
    assert "user@example.test" not in str(captured)
    assert "provider-secret" not in str(captured)
