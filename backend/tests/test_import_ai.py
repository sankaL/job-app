from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.services.import_ai import invoke_import_output


class ImportOutput(BaseModel):
    value: int


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
