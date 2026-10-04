"""Bounded Pydantic AI calls for import assistance, without hidden SDK retries."""
from __future__ import annotations

import asyncio
from typing import Any, Callable, TypeVar
from time import perf_counter

import httpx
from pydantic import BaseModel

from app.core.tracing import TraceConfig, end_trace_safely, trace_llm_scope

Output = TypeVar("Output", bound=BaseModel)


def _portable_openrouter_import_profile(model_name: str) -> Any:
    """Keep Google's tool transport subset separate from local validation."""
    if model_name.removeprefix("~").split("/", 1)[0] != "google":
        return None
    from pydantic_ai.providers.openrouter import OpenRouterProvider

    profile = OpenRouterProvider.model_profile(model_name)
    if profile is None or profile.get("json_schema_transformer") is None:
        raise RuntimeError("Google import schema compatibility is unavailable.")
    parent_transformer = profile["json_schema_transformer"]

    class GoogleImportSchemaTransformer(parent_transformer):
        def transform(self, schema):
            schema = super().transform(schema)
            # Preserve SDK inlining/nullable handling, then keep Google's
            # documented function-schema attributes at each schema node.
            # https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
            supported = {"type", "nullable", "required", "format", "description",
                "properties", "items", "enum", "anyOf", "$ref", "$defs"}
            for key in tuple(schema):
                if key not in supported:
                    del schema[key]
            return schema

    return {**profile, "json_schema_transformer": GoogleImportSchemaTransformer}


async def _invoke_import_output(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    output_type: type[Output],
    timeout_seconds: float,
    validator: Callable[[Output], None] | None = None,
    usage: Any,
) -> Output:
    # Import lazily: purely local PDF parsing does not initialize a provider.
    from openai import AsyncOpenAI
    from pydantic_ai import Agent, ModelRetry, ToolOutput, NativeOutput
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
            OpenRouterModel(model, provider=provider, profile=_portable_openrouter_import_profile(model)),
            system_prompt=system_prompt,
            # Provider transport constraints vary. Pydantic and source
            # validators enforce the complete contract locally.
            output_type=NativeOutput(output_type, strict=False) if model in {"google/gemini-3.8-flash", "openai/gpt-6-luna"} else ToolOutput(output_type, strict=False),
            retries=1,
            model_settings={"openrouter_reasoning": {"exclude": True}, "max_tokens": 16000, "timeout": timeout_seconds},
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
            agent.run(user_prompt, usage=usage, usage_limits=UsageLimits(request_limit=2, total_tokens_limit=60000)),
            timeout=timeout_seconds,
        )
        return result.output


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
    trace_config: TraceConfig = TraceConfig(),
    operation: str = "resume_import",
    is_fallback: bool = False,
) -> Output:
    """Trace every import invocation using counts, never prompt or output bodies."""
    from pydantic_ai.usage import RunUsage

    safe_operation = operation if operation in {"resume_cleanup", "resume_entry_extraction"} else "resume_import"
    usage = RunUsage()
    started = perf_counter()
    with trace_llm_scope(
        enabled=trace_config.enabled, api_key=trace_config.api_key,
        project_name=trace_config.project_name, workspace_id=trace_config.workspace_id,
        name=f"applix.{safe_operation}.pydantic_ai",
        inputs={"message_count": 2, "prompt_chars": len(system_prompt) + len(user_prompt)},
        metadata={"operation": safe_operation, "model": model, "is_fallback": is_fallback,
            "transport_mode": "pydantic_ai", "timeout_seconds": timeout_seconds, "request_limit": 2},
    ) as run_tree:
        outcome = "failed"
        try:
            output = await _invoke_import_output(
                api_key=api_key, base_url=base_url, model=model, system_prompt=system_prompt,
                user_prompt=user_prompt, output_type=output_type, timeout_seconds=timeout_seconds,
                validator=validator, usage=usage,
            )
            outcome = "success"
            return output
        except (TimeoutError, asyncio.TimeoutError):
            outcome = "timeout"
            raise
        finally:
            end_trace_safely(run_tree, outputs={"outcome": outcome,
                "request_count": max(1, usage.requests), "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens, "elapsed_ms": round((perf_counter() - started) * 1000)})
