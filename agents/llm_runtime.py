"""Pydantic AI calls with shared deadlines, usage limits, and safe diagnostics.

SDK transport retries are disabled. Pydantic AI may correct an invalid typed
response once, and callers explicitly decide whether to use a fallback or repair.
"""
from __future__ import annotations

import asyncio
import json
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
from time import perf_counter
from types import SimpleNamespace
from typing import Any, Callable, Optional

from pydantic import BaseModel
from langsmith_tracing import trace_scope, end_trace_safely, sanitize_trace_data, trace_content_enabled


SAFE_AI_OPERATIONS = {"generation", "regeneration_full", "regeneration_section", "keyword_optimization", "section_generation", "section_repair", "section_grounding_audit", "keyword_patch", "job_extraction", "keyword_extraction", "resume_judge", "structured_call"}
SAFE_PROVIDER_ERROR_CATEGORIES = {"strict_required", "invalid_schema", "reasoning", "unsupported_parameter", "authentication", "rate_limited", "provider_unavailable", "invalid_request", "provider_error"}
SAFE_PROVIDER_SCHEMA_FLAGS = {"strict", "required", "default", "nullable", "additionalProperties", "$ref", "$defs", "minLength", "maxLength", "minItems", "maxItems", "anyOf", "definitions", "parameters", "properties", "items", "type", "enum", "null", "function_declarations", "parameters_json_schema", "tool_config", "function_calling_config", "min_length", "max_length", "min_items", "max_items", "additional_properties"}
SAFE_PROVIDER_ERROR_CODES = {"invalid_json_schema", "invalid_schema", "invalid_request_error", "unsupported_parameter", "rate_limit_exceeded", "invalid_api_key", "insufficient_quota"}


def safe_provider_error_details(status_code: Any, body: Any) -> dict[str, Any]:
    """Classify bounded provider error text into fixed labels; never return it."""
    if type(status_code) is not int or not 400 <= status_code <= 599:
        return {}
    fragments: list[str] = []
    code = None
    visited = 0
    def visit(value: Any, depth: int = 0) -> None:
        nonlocal code, visited
        visited += 1
        if depth > 8 or visited > 128 or len(fragments) >= 32:
            return
        if isinstance(value, str):
            fragments.append(value[:2000])
            # OpenRouter may wrap upstream JSON as metadata.raw. Parsing only
            # small JSON-looking strings exposes nested known error keys to
            # this same bounded visitor; no decoded text is returned or saved.
            if len(value) <= 20000 and value.lstrip().startswith(("{", "[")):
                try:
                    nested = json.loads(value)
                except (ValueError, RecursionError):
                    pass
                else:
                    visit(nested, depth + 1)
        elif isinstance(value, list):
            for item in value[:32]:
                # Lists wrap error-envelope objects rather than add another
                # envelope level. The global node cap still bounds cycles.
                visit(item, depth)
        elif isinstance(value, dict):
            if isinstance(value.get("code"), str) and value["code"] in SAFE_PROVIDER_ERROR_CODES:
                code = value["code"]
            for key in ("error", "message", "type", "code", "param", "metadata", "raw", "details", "errors", "inner_error", "innerError", "detail", "reason", "description", "status", "fieldViolations", "field_violations", "violations", "field", "errorInfo", "error_info"):
                if key in value:
                    visit(value[key], depth + 1)
    visit(body)
    text = " ".join(fragments).casefold()
    if "strict" in text and ("required" in text or "all properties" in text):
        category = "strict_required"
    elif any(term in text for term in ("schema", "function.parameters", "function_declarations", "anyof", "definitions", "additionalproperties", "additional_properties")) or ("enum" in text and "null" in text):
        category = "invalid_schema"
    elif "reasoning" in text and any(word in text for word in ("unsupported", "unknown", "invalid", "mandatory", "parameter")):
        category = "reasoning"
    elif any(phrase in text for phrase in ("unsupported parameter", "unknown parameter", "parameter is not supported", "unsupported parameters")):
        category = "unsupported_parameter"
    elif status_code in {401, 403}:
        category = "authentication"
    elif status_code == 429:
        category = "rate_limited"
    elif status_code >= 500:
        category = "provider_unavailable"
    elif status_code == 400:
        category = "invalid_request"
    else:
        category = "provider_error"
    result: dict[str, Any] = {"http_status": status_code, "provider_error_category": category,
        "provider_schema_flags": sorted(flag for flag in SAFE_PROVIDER_SCHEMA_FLAGS
            if re.search(r"(?<![a-z0-9_])" + re.escape(flag.casefold()) + r"(?![a-z0-9_])", text))}
    if code:
        result["provider_error_code"] = code
    return result


def portable_openrouter_profile(model_name: str) -> Any:
    """Narrow Google tool schemas to its documented OpenAPI transport subset.

    Extend the pinned SDK's Google transformer so its definition inlining and
    nullable-union handling stay intact. Constraints omitted from transport
    remain enforced by the original output model and local section validators.
    Other upstream profiles use the SDK's unmodified defaults.
    """
    if model_name.removeprefix("~").split("/", 1)[0] != "google":
        return None
    from pydantic_ai.providers.openrouter import OpenRouterProvider

    profile = OpenRouterProvider.model_profile(model_name)
    if profile is None or profile.get("json_schema_transformer") is None:
        raise RuntimeError("Google provider schema compatibility is unavailable.")
    parent_transformer = profile["json_schema_transformer"]

    class GoogleFunctionSchemaTransformer(parent_transformer):
        def transform(self, schema):
            schema = super().transform(schema)
            # Function `parameters` accepts this narrower subset, rather than
            # every constraint accepted by Google's structured-output mode.
            # https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
            supported = {"type", "nullable", "required", "format", "description",
                "properties", "items", "enum", "anyOf", "$ref", "$defs"}
            for key in tuple(schema):
                if key not in supported:
                    del schema[key]
            return schema

    return {**profile, "json_schema_transformer": GoogleFunctionSchemaTransformer}


class AIRequestError(RuntimeError):
    """Safe exception boundary: provider payloads never reach worker logs."""
    def __init__(self, error_type: str, *, reasoning_rejected: bool = False, can_fallback: bool = True) -> None:
        self.can_fallback = can_fallback
        self.error_type = error_type
        self.reasoning_rejected = reasoning_rejected
        super().__init__("AI provider rejected unsupported reasoning." if reasoning_rejected else "AI provider request failed.")


@dataclass
class CallBudget:
    deadline: float
    max_requests: int = 6
    max_output_tokens: int = 24_000
    requests: int = 0
    output_tokens: int = 0
    attempts: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def for_seconds(cls, seconds: float, *, max_requests: int = 6) -> "CallBudget":
        return cls(deadline=perf_counter() + seconds, max_requests=max_requests)

    def remaining_seconds(self) -> float:
        remaining = self.deadline - perf_counter()
        if remaining <= 0:
            raise asyncio.TimeoutError("The AI workflow deadline was reached.")
        if self.requests >= self.max_requests or self.output_tokens >= self.max_output_tokens:
            raise RuntimeError("The AI workflow usage budget was reached.")
        return remaining

_workflow_budget: ContextVar[Optional[CallBudget]] = ContextVar("resume_ai_budget", default=None)

def current_call_budget() -> Optional[CallBudget]:
    return _workflow_budget.get()

def bounded_ai_workflow(seconds: Any, *, max_requests: int = 6):
    """Share provider/correction/fallback usage across one asynchronous workflow."""
    def decorate(function):
        @wraps(function)
        async def run(*args, **kwargs):
            existing = _workflow_budget.get()
            if existing is not None:
                return await function(*args, **kwargs)
            duration = seconds(kwargs) if callable(seconds) else seconds
            token = _workflow_budget.set(CallBudget.for_seconds(duration, max_requests=max_requests))
            try:
                return await asyncio.wait_for(function(*args, **kwargs), timeout=duration)
            finally:
                _workflow_budget.reset(token)
        return run
    return decorate



def _request_trace_metadata(settings: dict[str, Any], *, output_type: Any, native_output: bool, retries: int) -> dict[str, Any]:
    """Describe the request settings actually sent, without prompt content."""
    reasoning = settings.get("openrouter_reasoning")
    reasoning = reasoning if isinstance(reasoning, dict) else {}
    return {
        "output_mode": "native" if native_output else "tool",
        "output_type": getattr(output_type, "__name__", type(output_type).__name__),
        "temperature": "provider_default" if settings.get("temperature") is None else settings["temperature"],
        "max_tokens": settings.get("max_tokens"),
        "reasoning_effort": str(reasoning.get("effort") or "provider_default"),
        "reasoning_text_excluded": reasoning.get("exclude") is True,
        "output_retries": retries,
    }


async def structured_call(
    *,
    prompt: list[tuple[str, str]],
    output_type: Any,
    model_name: str,
    api_key: str,
    base_url: str,
    budget: CallBudget,
    timeout: Optional[float] = None,
    temperature: float = 0.2,
    reasoning: Optional[dict[str, Any]] = None,
    output_validator: Optional[Callable[[Any], Any]] = None,
    operation: str = "structured_call",
    is_fallback: bool = False,
) -> Any:
    # Lazy imports allow the deterministic document/validation code to run on its
    # own. A missing runtime dependency still fails closed at the call boundary.
    from openai import AsyncOpenAI
    from pydantic_ai import Agent, ModelRetry, ToolOutput, NativeOutput
    from pydantic_ai.models.openrouter import OpenRouterModel
    from pydantic_ai.providers.openrouter import OpenRouterProvider
    from pydantic_ai.usage import RunUsage, UsageLimits

    if not api_key or not model_name:
        raise RuntimeError("AI provider credentials and model must be configured.")
    remaining = budget.remaining_seconds()
    call_timeout = min(remaining, timeout or remaining)
    remaining_requests = budget.max_requests - budget.requests
    usage = RunUsage()
    system = "\n\n".join(content for role, content in prompt if role == "system")
    user = "\n\n".join(content for role, content in prompt if role != "system")
    started = perf_counter()
    client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=call_timeout)
    native_output = model_name.removeprefix("~") in {"anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "openai/gpt-6-luna"}
    settings: dict[str, Any] = { "max_tokens": min(8000, budget.max_output_tokens - budget.output_tokens), "openrouter_provider": {"require_parameters": True}}
    if not native_output:
        settings["temperature"] = temperature
    settings["openrouter_reasoning"] = {"exclude": True} if native_output else reasoning
    if settings["openrouter_reasoning"] is None:
        settings.pop("openrouter_reasoning")
    safe_operation = operation if operation in SAFE_AI_OPERATIONS else "structured_call"
    trace_manager = None
    run_trace = None
    include_content = False
    output_value: Any = None
    outcome = "failed"
    try:
        include_content = trace_content_enabled()
        trace_inputs: dict[str, Any] = {"message_count": len(prompt), "prompt_chars": sum(len(content) for _, content in prompt)}
        if include_content:
            trace_inputs["messages"] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        trace_manager = trace_scope(
            "applix." + safe_operation + ".pydantic_ai", run_type="llm",
            inputs=trace_inputs,
            metadata={"operation": safe_operation, "model": model_name, "is_fallback": is_fallback, "request_limit": remaining_requests, "timeout_seconds": call_timeout,
                **_request_trace_metadata(settings, output_type=output_type, native_output=native_output, retries=1 if remaining_requests > 1 else 0),
                "content_traced": include_content},
            tags=["applix", safe_operation, "pydantic_ai"],
        )
        run_trace = trace_manager.__enter__()
    except Exception:
        trace_manager = None  # Telemetry availability never controls AI success.
    try:
        model = OpenRouterModel(model_name, provider=OpenRouterProvider(openai_client=client),
            profile=portable_openrouter_profile(model_name))
        agent = Agent(
            model,
            # Gateway profiles may incorrectly auto-enable native strict tools
            # for portable nullable/default/dictionary schemas. Local typed and
            # per-section validation remains strict and fail closed.
            output_type=NativeOutput(output_type, strict=False) if native_output else ToolOutput(output_type, strict=False),
            system_prompt=system,
            retries=1 if remaining_requests > 1 else 0,
        )
        if output_validator is not None:
            @agent.output_validator
            def validate_output(value: Any) -> Any:
                try:
                    return output_validator(value)
                except ValueError as error:
                    # Validators supply error codes, never source text or model
                    # output. Pydantic AI feeds this bounded correction back.
                    raise ModelRetry(str(error)) from error

        result = await asyncio.wait_for(
            agent.run(
                user,
                model_settings=settings,
                usage=usage,
                usage_limits=UsageLimits(
                    request_limit=remaining_requests,
                    output_tokens_limit=budget.max_output_tokens - budget.output_tokens,
                ),
            ),
            timeout=call_timeout,
        )
        outcome = "success"
        output_value = result.output
        budget.attempts.append({
            "model": model_name,
            "transport_mode": "pydantic_ai",
            "outcome": "success",
            "elapsed_ms": round((perf_counter() - started) * 1000),
            "operation": operation,
        })
        return result.output
    except Exception as error:
        budget.attempts.append({
            "model": model_name,
            "transport_mode": "pydantic_ai",
            "outcome": "timeout" if isinstance(error, (TimeoutError, asyncio.TimeoutError)) else "failed",
            "error_type": type(error).__name__,
            "elapsed_ms": round((perf_counter() - started) * 1000),
            "operation": operation,
            **safe_provider_error_details(getattr(error, "status_code", None), getattr(error, "body", None)),
        })
        if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
            raise asyncio.TimeoutError("AI provider request timed out.") from None
        message = str(error).lower()
        reasoning_rejected = "reasoning" in message and any(word in message for word in ("unknown", "unsupported", "invalid", "mandatory"))
        raise AIRequestError(type(error).__name__, reasoning_rejected=reasoning_rejected,
            can_fallback=getattr(error, "status_code", None) not in {401, 402, 403}) from None
    finally:
        # Failed HTTP requests may not have a usage record. They still consume
        # a workflow request, preventing retries from multiplying invisibly.
        budget.requests += max(1, usage.requests)
        budget.output_tokens += usage.output_tokens
        trace_outputs: dict[str, Any] = {"outcome": outcome, "request_count": max(1, usage.requests), "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens}
        if include_content and outcome == "success":
            try:
                trace_outputs["output"] = sanitize_trace_data(
                    output_value.model_dump(mode="json") if isinstance(output_value, BaseModel) else output_value)
            except Exception:
                trace_outputs["output"] = "<unavailable>"  # Telemetry never replaces the AI result or skips cleanup.
        end_trace_safely(run_trace, outputs=trace_outputs)
        if trace_manager is not None:
            try:
                trace_manager.__exit__(None, None, None)
            except Exception:
                pass  # Optional telemetry cleanup must not mask the safe result.
        await client.close()


class StructuredLLM:
    """Small compatibility adapter for the existing prompt/transport boundary."""

    def __init__(self, *, model: str, api_key: str, base_url: str, temperature: float = 0,
                 request_timeout: float = 30, max_retries: int = 0,
                 extra_body: Optional[dict[str, Any]] = None, **_kwargs: Any) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url
        self.temperature = temperature
        self.timeout = request_timeout
        self.reasoning = (extra_body or {}).get("reasoning")
        self.output_type: Any = None

    def with_structured_output(self, output_type: Any) -> "StructuredLLM":
        self.output_type = output_type
        return self

    async def ainvoke(self, prompt: list[tuple[str, str]], config: Optional[dict[str, Any]] = None) -> Any:
        value = await structured_call(
            prompt=prompt,
            output_type=self.output_type or dict[str, Any],
            model_name=self.model,
            api_key=self.api_key,
            base_url=self.base_url,
            budget=current_call_budget() or CallBudget.for_seconds(self.timeout, max_requests=2),
            timeout=self.timeout,
            temperature=self.temperature,
            reasoning=self.reasoning,
            operation=str((config or {}).get("metadata", {}).get("operation") or "structured_call"),
            is_fallback=(config or {}).get("metadata", {}).get("is_fallback") is True,
        )
        if self.output_type is not None:
            return value
        payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
        return SimpleNamespace(content=json.dumps(payload))
