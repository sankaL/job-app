"""Bounded Pydantic AI calls for import assistance, without hidden SDK retries."""
from __future__ import annotations

import asyncio
from typing import Callable, TypeVar

import httpx
from pydantic import BaseModel

Output = TypeVar("Output", bound=BaseModel)


async def invoke_import_output(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    output_type: type[Output],
    timeout_seconds: float,
    validator: Callable[[Output], None] | None = None,
) -> Output:
    # Import lazily: purely local PDF parsing does not initialize a provider.
    from openai import AsyncOpenAI
    from pydantic_ai import Agent, ModelRetry, ToolOutput
    from pydantic_ai.models.openrouter import OpenRouterModel
    from pydantic_ai.providers.openrouter import OpenRouterProvider
    from pydantic_ai.usage import UsageLimits

    async with httpx.AsyncClient(timeout=timeout_seconds) as http_client:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            max_retries=0,
            timeout=timeout_seconds,
            http_client=http_client,
        )
        provider = OpenRouterProvider(openai_client=client)
        agent = Agent(
            OpenRouterModel(model, provider=provider),
            system_prompt=system_prompt,
            output_type=ToolOutput(output_type, strict=True),
            retries=1,
            model_settings={"temperature": 0.0, "max_tokens": 16000, "timeout": timeout_seconds},
        )
        if validator is not None:
            @agent.output_validator
            def validate_output(output: Output) -> Output:
                try:
                    validator(output)
                except ValueError as error:
                    # Validator messages must describe rules, never source text.
                    raise ModelRetry(str(error)) from error
                return output

        result = await asyncio.wait_for(
            agent.run(user_prompt, usage_limits=UsageLimits(request_limit=2, total_tokens_limit=60000)),
            timeout=timeout_seconds,
        )
        return result.output
