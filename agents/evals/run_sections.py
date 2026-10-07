"""Run the production section pipeline with synthetic facts and bounded usage.

Default mode uses httpx.MockTransport and the real Pydantic AI runtime. Live
mode must be selected explicitly and never reads or writes application data.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import logging
import math
import os
from pathlib import Path
import re
import contextvars
import sys
from time import perf_counter
from typing import Any
from unittest.mock import patch
from urllib.parse import urlsplit

AGENTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENTS_ROOT))

import httpx
from dotenv import dotenv_values
import openai

import llm_runtime
import model_config
import langsmith_tracing as tracing
import section_generation as pipeline
from resume_document import render_resume_document, validate_resume_document
from evals.fixtures import CASES, JOB_DESCRIPTION, PRIVACY_VALUES, UNSUPPORTED_TERMS, Case, case_settings, current_document, offline_writer, source_document


# Concurrent writer groups share one meter; tag each HTTP request with its call.
_CALL_ID: contextvars.ContextVar[Any] = contextvars.ContextVar("evaluation_call_id", default=None)


class EvaluationLimit(RuntimeError):
    """Safe run-level stop condition, without provider or fixture content."""


def configuration(env_file: Path | None) -> dict[str, str]:
    values = {key: str(value) for key, value in dotenv_values(env_file).items() if value is not None} if env_file and env_file.exists() else {}
    return {**values, **os.environ}


def configuration_status(values: dict[str, str]) -> dict[str, bool]:
    key = values.get("OPENROUTER_API_KEY", "").strip()
    endpoint = urlsplit(values.get("OPENROUTER_BASE_URL", ""))
    return {"dev_mode": values.get("APP_DEV_MODE", "").lower() in {"true", "1", "yes"},
        "api_key_configured": bool(key) and key not in {"test-only", "test", "mock"},
        # Models come from shared/model-config.json roles, not the environment.
        "primary_model_configured": bool(model_config.route("resume_writer").model),
        "fallback_model_configured": bool(model_config.route("resume_writer").fallback),
        "routine_models_configured": bool(model_config.route("section_writer").model and model_config.route("section_writer").fallback),
        "provider_endpoint_configured": bool(values.get("OPENROUTER_BASE_URL", "").strip()),
        "provider_endpoint_is_openrouter": endpoint.hostname == "openrouter.ai" and endpoint.scheme == "https"
            and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment}


def unsupported_term_present(text: str) -> bool:
    return any(re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text, re.I) for term in UNSUPPORTED_TERMS)


def safe_diagnostics(error: Exception) -> dict[str, Any]:
    codes = []
    for item in getattr(error, "validation_errors", [])[:30]:
        if not isinstance(item, dict):
            continue
        code, section = str(item.get("type", "")), str(item.get("section", ""))
        if re.fullmatch(r"[a-z][a-z0-9_,]{0,300}", code) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", section):
            codes.append({"type": code, "section": section})
    return {"validation_errors": codes} if codes else {}


def safe_attempts(attempts: list[dict[str, Any]], model_roles: dict[str, str]) -> list[dict[str, Any]]:
    # These fields originate in the runtime and record_output_shape, which
    # accepts only counts and fixed schema-key/section-kind token allowlists.
    return [{key: model_roles.get(value, "unknown") if key == "model" else value
        for key, value in attempt.items() if key in {"model", "operation", "outcome", "error_type", "elapsed_ms", "output_shape", "http_status", "provider_error_category", "provider_error_code", "provider_schema_flags"}}
        for attempt in attempts]


def diagnostic_error_messages(body: Any, redactions: list[str]) -> list[str]:
    """Opt-in synthetic evaluator debugging. Never return a provider body."""
    messages: list[str] = []
    visited = 0
    def sanitize(message: str) -> str:
        # Request echoes are unnecessary to diagnose API/schema rejection.
        echo = re.search(r'(?is)["\'](?:messages|reviewed_source|requested_sections|current_document|job_description|prompt|inputs|role)["\']\s*:|Write a truthful tailored resume|#\s*Unslop', message)
        if echo:
            message = message[:echo.start()] + "[request content omitted]"
        if len(message) > 2000:
            return "[oversized provider message omitted]"
        for value in sorted({value.strip() for value in redactions if value.strip()}, key=len, reverse=True):
            message = re.sub(re.escape(value), "[redacted]", message, flags=re.I)
        message = re.sub(r'(?i)\bsk-[A-Za-z0-9_-]+\b|\bbearer\s+[^\s,;]+', "[credential]", message)
        message = re.sub(r'(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', "[contact]", message)
        message = pipeline.PHONE_RE.sub("[contact]", message)
        message = re.sub(r'https?://[^\s\"\'<>]+', "[url]", message, flags=re.I)
        return message.replace("\n", " ").replace("\r", " ")[:500]
    def visit(value: Any, depth: int = 0) -> None:
        nonlocal visited
        visited += 1
        if visited > 128 or depth > 8 or len(messages) >= 3:
            return
        if isinstance(value, dict):
            if isinstance(value.get("message"), str):
                safe = sanitize(value["message"])
                if safe and safe not in messages:
                    messages.append(safe)
            if isinstance(value.get("error"), str) and not value["error"].lstrip().startswith(("{", "[")):
                safe = sanitize(value["error"])
                if safe and safe not in messages:
                    messages.append(safe)
            for key in ("error", "metadata", "raw", "inner_error", "innerError", "details", "errors"):
                if key in value:
                    visit(value[key], depth + 1)
        elif isinstance(value, list):
            for item in value[:32]:
                visit(item, depth)
        elif isinstance(value, str) and len(value) <= 20000 and value.lstrip().startswith(("{", "[")):
            try:
                nested = json.loads(value)
            except (ValueError, RecursionError):
                return
            visit(nested, depth + 1)
    visit(body)
    return messages


def synthetic_redactions(values: dict[str, str]) -> list[str]:
    redactions = [*PRIVACY_VALUES, JOB_DESCRIPTION, "Backend Engineer", "Fictional Northstar Tools"]
    for key in ("OPENROUTER_API_KEY", "LANGSMITH_API_KEY"):
        value = values.get(key, "").strip()
        if value:
            redactions.append(value)
    for value in {name for route in model_config.get_model_config().roles.values() for name in (route.model, route.fallback) if name}:
        redactions.extend([value, value.split("/", 1)[-1]])
    for document in (source_document(), current_document()):
        for section in document["sections"]:
            redactions.append(section["content_md"])
            for entry in section["entries"]:
                redactions.extend(entry["fields"].values())
                redactions.extend(bullet["text"] for bullet in entry["bullets"])
    return redactions


class RunMeter:
    def __init__(self, *, live: bool, max_requests: int, max_output_tokens: int, max_seconds: float, max_cost_usd: Decimal) -> None:
        self.live = live
        self.max_requests = max_requests
        self.max_output_tokens = max_output_tokens
        self.deadline = perf_counter() + max_seconds
        self.max_cost_usd = max_cost_usd
        self.reserved_output_tokens = 0
        self.cost_usd = Decimal("0")
        self.cost_missing = False
        self.requests: list[dict[str, Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.current_case: Case | None = None
        self.operation = ""
        self.model_roles: dict[str, str] = {}
        self.fault_used: set[str] = set()
        self.stop_reason: str | None = None
        self.diagnostic_errors = False
        self.diagnostic_redactions: list[str] = []

    def check(self) -> None:
        reason = None
        if perf_counter() >= self.deadline:
            reason = "run_deadline"
        elif len(self.requests) >= self.max_requests:
            reason = "run_request_limit"
        elif self.cost_usd >= self.max_cost_usd:
            reason = "run_cost_stop_threshold"
        elif self.live and self.cost_missing:
            reason = "provider_cost_metadata_missing"
        if reason:
            self.stop_reason = reason
            raise EvaluationLimit(reason)

    async def structured_call(self, **kwargs: Any) -> Any:
        self.check()
        self.operation = kwargs.get("operation", "structured_call")
        budget = kwargs["budget"]
        budget.deadline = min(budget.deadline, self.deadline)
        budget.max_requests = min(budget.max_requests, budget.requests + self.max_requests - len(self.requests))
        budget.max_output_tokens = min(budget.max_output_tokens, budget.output_tokens + self.max_output_tokens - self.reserved_output_tokens)
        started = perf_counter()
        operation = self.operation
        call_id = object()
        token = _CALL_ID.set(call_id)
        outcome = "failed"
        try:
            result = await llm_runtime.structured_call(**kwargs)
            outcome = "success"
            return result
        finally:
            _CALL_ID.reset(token)
            self.calls.append({"case": self.current_case.id if self.current_case else "", "operation": operation,
                "model_role": self.model_roles.get(kwargs["model_name"], "unknown"), "outcome": outcome,
                "request_count": sum(record.get("_call") is call_id for record in self.requests),
                "elapsed_ms": round((perf_counter() - started) * 1000)})

    def synthetic_response(self, data: dict[str, Any]) -> dict[str, Any]:
        case = self.current_case
        if case is None:
            raise EvaluationLimit("missing_case")
        user_content = next(item["content"] for item in data["messages"] if item["role"] == "user")
        if isinstance(user_content, list):  # Cache-split prompts arrive as text parts.
            user_content = "\n\n".join(part.get("text", "") for part in user_content if isinstance(part, dict))
        decoder = json.JSONDecoder()
        payload, end = decoder.raw_decode(user_content)
        rest = user_content[end:].lstrip()
        if rest.startswith("{"):
            try:
                payload = {**payload, **decoder.raw_decode(rest)[0]}
            except ValueError:
                pass
        # Concurrent writer groups share this meter, so classify by request content.
        if "sections_to_verify" in payload:
            assessments = []
            for section in payload["sections_to_verify"]:
                invented = "Rust" in json.dumps(section)
                assessments.append({"id": section["id"], "supported": not invented,
                    "issues": ["unsupported_technology"] if invented else []})
            return {"sections": assessments}
        response = offline_writer(payload)
        # Concurrent writer groups arrive in any order: inject each fault into the
        # Experience response so offline totals stay deterministic.
        has_experience = any(section["id"] == "experience" for section in response["sections"])
        if case.fault and case.id not in self.fault_used and has_experience:
            self.fault_used.add(case.id)
            if case.fault == "schema":
                return {"malformed_envelope": True}
            experience = next(section for section in response["sections"] if section["id"] == "experience")
            text = experience["entries"][0]["bullets"][0]["text"]
            experience["entries"][0]["bullets"][0]["text"] = text.replace("35%", "99%") if case.fault == "metric" else text + " Used Rust."
        return response

    async def response_hook(self, response: httpx.Response) -> None:
        await response.aread()
        try:
            record = response.request.extensions.get("evaluation_record") or self.requests[-1]
        except RuntimeError:  # Directly constructed responses in tests carry no request.
            record = self.requests[-1]
        record["status"] = response.status_code
        if not response.is_success:
            try:
                body = response.json()
            except ValueError:
                body = response.text[:4000]
            record.update(llm_runtime.safe_provider_error_details(response.status_code, body))
            if self.diagnostic_errors:
                record["diagnostic_error_messages"] = diagnostic_error_messages(body, self.diagnostic_redactions)
            return
        try:
            usage = response.json().get("usage", {})
            record["input_tokens"] = int(usage.get("prompt_tokens", 0))
            record["output_tokens"] = int(usage.get("completion_tokens", 0))
            if usage.get("cost") is None:
                self.cost_missing = True
                record["cost_usd"] = None
            else:
                cost = Decimal(str(usage["cost"]))
                if not cost.is_finite() or cost < 0:
                    raise ValueError("Invalid usage cost.")
                self.cost_usd += cost
                record["cost_usd"] = str(cost)
        except (ValueError, TypeError, InvalidOperation):
            self.cost_missing = True
            record["cost_usd"] = None

    async def request_hook(self, request: httpx.Request) -> None:
        self.check()
        data = json.loads(request.content)
        if any(value.casefold() in request.content.decode().casefold() for value in PRIVACY_VALUES):
            self.stop_reason = "outbound_privacy_failed"
            raise EvaluationLimit(self.stop_reason)
        maximum = int(data.get("max_tokens", data.get("max_completion_tokens", 0)))
        if not 0 < maximum <= self.max_output_tokens - self.reserved_output_tokens:
            self.stop_reason = "run_output_reservation_limit"
            raise EvaluationLimit(self.stop_reason)
        # Reserve the full requested output allowance before each HTTP request.
        # Even output-correction requests cannot exceed the run's reservation.
        self.reserved_output_tokens += maximum
        record = {"_call": _CALL_ID.get(), "case": self.current_case.id if self.current_case else "", "operation": self.operation,
            "model_role": self.model_roles.get(data.get("model", ""), "unknown"),
            "reserved_output_tokens": maximum, "input_tokens": None, "output_tokens": None, "cost_usd": None}
        self.requests.append(record)
        request.extensions["evaluation_record"] = record

    async def mock_response(self, request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        output = self.synthetic_response(data)
        name = data["tools"][0]["function"]["name"]
        return httpx.Response(200, json={"id": "synthetic-completion", "object": "chat.completion", "created": 1,
            "model": data["model"], "provider": "Synthetic", "choices": [{"index": 0, "finish_reason": "tool_calls",
                "message": {"role": "assistant", "content": None, "tool_calls": [{"id": "synthetic-tool", "type": "function",
                    "function": {"name": name, "arguments": json.dumps(output)}}]}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 100, "total_tokens": 200, "cost": 0.0001}})


def assertions(case: Case, result: dict[str, Any], settings: dict[str, Any]) -> dict[str, bool]:
    source = validate_resume_document(source_document())
    output = validate_resume_document(result["document"])
    rendered = render_resume_document(output)
    checks = {"source_snapshot_exact": result["source_snapshot"] == settings["_source_snapshot"],
        "no_contact_in_enabled_output": not any(value.casefold() in rendered.casefold() for value in PRIVACY_VALUES),
        "no_known_unsupported_claims": not unsupported_term_present(rendered)}
    if case.operation == "keyword_optimization":
        current = validate_resume_document(settings["_current_document"])
        checks["local_boundary_valid"] = pipeline.validate_keyword_document(output=output, current=current, source=source, privacy_values=PRIVACY_VALUES)["valid"]
        # Existing phrases must survive even when no safe missing keyword can be added.
        previous_text = render_resume_document(current).casefold()
        checks["matched_keywords_preserved"] = all(keyword not in previous_text or keyword in rendered.casefold()
            for keyword in [str(value).casefold() for value in settings["keyword_optimization"]["preserve_keywords"]])
        checks["supported_missing_keyword_added"] = "billing services" in rendered.casefold()
        before = next(section for section in current.sections if section.id == "experience")
        after = next(section for section in output.sections if section.id == "experience")
        checks["manual_role_preserved"] = before.entries[-1].model_dump() == after.entries[-1].model_dump()
        checks["manual_wording_preserved"] = "My unrelated manual wording stays here." in rendered
        checks["unrelated_sections_preserved"] = all(section.model_dump() == next(item for item in output.sections if item.id == section.id).model_dump()
            for section in current.sections if section.id in {"summary", "education", "manual-custom"})
    else:
        target_ids = result["section_ids"]
        sections = [section for section in result["sections"] if section["name"] in target_ids]
        checks["local_boundary_valid"] = pipeline.validate_document_sections(generated_sections=sections, source_payload=source.model_dump(mode="json"),
            generation_settings=settings, expected_ids=target_ids)["valid"]
        if case.operation == "regeneration_section":
            current = validate_resume_document(settings["_current_document"])
            checks["unrelated_sections_preserved"] = all(section.model_dump() == next(item for item in output.sections if item.id == section.id).model_dump()
                for section in current.sections if section.id != "experience")
            before = next(section for section in current.sections if section.id == "experience")
            after = next(section for section in output.sections if section.id == "experience")
            checks["untouched_roles_preserved"] = all(entry.model_dump() == next(item for item in after.entries if item.id == entry.id).model_dump()
                for entry in before.entries if entry.id != "role-one")
            checks["current_entry_order_preserved"] = [entry.id for entry in before.entries] == [entry.id for entry in after.entries]
        else:
            checks["section_order_preserved"] = [section.id for section in source.sections] == [section.id for section in output.sections]
            checks["fixed_sections_exact"] = all(section.model_dump() == next(item for item in output.sections if item.id == section.id).model_dump()
                for section in source.sections if section.kind in {"education", "certifications"})
    return checks


async def run_cases(cases: list[Case], values: dict[str, str], args: argparse.Namespace) -> dict[str, Any]:
    live = args.live
    status = configuration_status(values)
    if live and not all(status.values()):
        raise EvaluationLimit("Live evaluation requires configured dev-mode OpenRouter credentials and both models.")
    if live and any(case.fault for case in cases):
        raise EvaluationLimit("Injected recovery fixtures are offline-only.")
    # The first writer is chosen per case aggressiveness, as in the worker.
    writers = {case.aggressiveness: model_config.route("resume_writer", case.aggressiveness) for case in cases}
    def writer_models(case: Case) -> tuple[str, str]:
        if not live:
            return "eval/primary", "eval/fallback"
        route = writers[case.aggressiveness]
        return route.model, route.fallback or route.model
    meter = RunMeter(live=live, max_requests=args.max_requests, max_output_tokens=args.max_output_tokens,
        max_seconds=args.max_seconds, max_cost_usd=Decimal(str(args.max_cost_usd)))
    routine = model_config.route("section_writer").model if live else "eval/routine"
    routine_fallback = (model_config.route("section_writer").fallback or routine) if live else "eval/routine-fallback"
    meter.model_roles = {routine: "routine", routine_fallback: "routine-fallback",
        **{name: "fallback" for case in cases for name in writer_models(case)[1:]},
        **{writer_models(case)[0]: "primary" for case in cases}}
    meter.diagnostic_errors = bool(getattr(args, "diagnostic_errors", False))
    meter.diagnostic_redactions = synthetic_redactions(values) if meter.diagnostic_errors else []
    original_client = openai.AsyncOpenAI
    def measured_client(**kwargs: Any):
        kwargs["http_client"] = httpx.AsyncClient(event_hooks={"request": [meter.request_hook], "response": [meter.response_hook]},
            transport=httpx.AsyncHTTPTransport(retries=0) if live else httpx.MockTransport(meter.mock_response))
        return original_client(**kwargs)
    results = []
    started = perf_counter()
    with ExitStack() as stack:
        stack.enter_context(patch.object(openai, "AsyncOpenAI", measured_client))
        stack.enter_context(patch.object(pipeline, "structured_call", meter.structured_call))
        if live:
            # Resolve the merged --env-file/environment settings explicitly.
            # The runtime reads these settings only within this bounded run.
            trace_settings = tracing._TraceSettings(_env_file=None,
                langsmith_tracing=values.get("LANGSMITH_TRACING", "false"),
                langsmith_project=values.get("LANGSMITH_PROJECT"),
                langsmith_workspace_id=values.get("LANGSMITH_WORKSPACE_ID"),
                langsmith_api_key=values.get("LANGSMITH_API_KEY"))
            stack.enter_context(patch.object(tracing, "_TraceSettings", lambda: trace_settings))
            tracing._trace_config()  # Invalid enabled configuration blocks provider work.
            original_scope = tracing.trace_scope
            def evaluation_scope(name, **kwargs):
                kwargs["metadata"] = {**kwargs.get("metadata", {}),
                    "evaluation": True, "case": meter.current_case.id, "environment": "development"}
                kwargs["tags"] = [*kwargs.get("tags", []), "evaluation", "live"]
                return original_scope(name, **kwargs)
            stack.enter_context(patch.object(llm_runtime, "trace_scope", evaluation_scope))
        else:
            # Offline checks never create a telemetry client, even with ambient credentials.
            stack.enter_context(patch.object(llm_runtime, "trace_scope", lambda *_args, **_kwargs: nullcontext(None)))
        for case in cases:
            meter.current_case = case
            settings = {**case_settings(case), "_routine_model": routine, "_routine_fallback_model": routine_fallback}
            model, fallback = writer_models(case)
            case_started = perf_counter()
            try:
                meter.check()
                result = await pipeline.generate_document(source_payload=source_document(), generation_settings=settings, section_preferences=[],
                    job_title="Backend Engineer", company_name="Fictional Northstar Tools", job_description=JOB_DESCRIPTION,
                    model=model if case.operation in {"generation", "regeneration_full"} else routine,
                    fallback_model=fallback if case.operation in {"generation", "regeneration_full"} else routine_fallback, api_key=values["OPENROUTER_API_KEY"] if live else "synthetic",
                    base_url=values["OPENROUTER_BASE_URL"] if live else "https://synthetic.invalid/v1", on_progress=None,
                    reasoning_effort="auto",
                    target_section_id="experience" if case.operation == "regeneration_section" else None,
                    instructions="Emphasize grounded API testing and documentation for this role. Preserve the factual source history." if case.operation == "regeneration_section" else None)
                checks = assertions(case, result, settings)
                row: dict[str, Any] = {"case": case.id, "status": "passed" if all(checks.values()) else "failed",
                    "checks": checks, "word_count": len(render_resume_document(validate_resume_document(result["document"])).split())}
                if args.save_documents:
                    row["document"] = result["document"]  # Synthetic material only.
                row["attempts"] = safe_attempts(result.get("attempt_diagnostics", []), meter.model_roles)
            except Exception as error:
                row = {"case": case.id, "status": "failed", "error_type": type(error).__name__,
                    "stop_reason": meter.stop_reason, **safe_diagnostics(error),
                    "attempts": safe_attempts(getattr(error, "attempt_diagnostics", []), meter.model_roles)}
            row["elapsed_ms"] = round((perf_counter() - case_started) * 1000)
            results.append(row)
            if meter.stop_reason:
                break
    return {"schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(), "mode": "live" if live else "offline",
        "synthetic_data_only": True, "configuration_available": status,
        "limits": {"max_requests": args.max_requests, "max_reserved_output_tokens": args.max_output_tokens,
            "max_seconds": args.max_seconds, "cost_stop_threshold_usd": str(args.max_cost_usd)},
        "totals": {"requests": len(meter.requests), "input_tokens": sum(record["input_tokens"] or 0 for record in meter.requests),
            "output_tokens": sum(record["output_tokens"] or 0 for record in meter.requests), "reserved_output_tokens": meter.reserved_output_tokens,
            "cost_usd": str(meter.cost_usd), "cost_metadata_complete": not meter.cost_missing,
            "cost_kind": "provider_reported" if live else "synthetic_fixture", "elapsed_ms": round((perf_counter() - started) * 1000),
            "schema_correction_requests": sum(max(0, call["request_count"] - 1) for call in meter.calls),
            "section_repair_calls": sum(call["operation"] == "section_repair" for call in meter.calls)},
        "stop_reason": meter.stop_reason, "results": results, "calls": meter.calls,
        "requests": [{key: value for key, value in record.items() if key != "_call"} for record in meter.requests],
        "limitations": ["Passing deterministic checks and the pipeline's semantic audit does not prove factual truth.",
            "Charged cost may cross the stop threshold on the final in-flight request; it is not a hard dollar ceiling.",
            "Offline usage and timing do not predict live-provider quality, cost or latency."]}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--live", action="store_true", help="Explicitly allow synthetic OpenRouter requests.")
    result.add_argument("--check-config", action="store_true", help="Print availability booleans only; make no requests.")
    result.add_argument("--env-file", type=Path, help="Optional local configuration file; values are never printed.")
    result.add_argument("--case", action="append", choices=[case.id for case in CASES], help="Repeat to select cases. Offline default: all. Live default: full_low.")
    result.add_argument("--max-requests", type=int, default=64)
    result.add_argument("--max-output-tokens", type=int, default=512000, help="Total reserved output allowance across HTTP requests.")
    result.add_argument("--max-seconds", type=float, default=360)
    result.add_argument("--max-cost-usd", type=Decimal, default=Decimal("1.00"), help="Stop subsequent requests at this reported charged-cost threshold.")
    result.add_argument("--output", type=Path, help="Optional local JSON metrics artifact.")
    result.add_argument("--save-documents", action="store_true", help="Include synthetic generated documents for human review.")
    result.add_argument("--diagnostic-errors", action="store_true", help="Synthetic debugging only: include up to three redacted provider error messages, capped at 500 characters each.")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.max_requests < 1 or args.max_output_tokens < 1 or not math.isfinite(args.max_seconds) or args.max_seconds <= 0 or not args.max_cost_usd.is_finite() or args.max_cost_usd <= 0:
        raise SystemExit("Limits must be positive, finite values.")
    # Optional libraries may log URLs or provider errors. The evaluator emits
    # its own safe metrics and never copies exception text into reports.
    logging.disable(logging.CRITICAL)
    values = configuration(args.env_file)
    if args.check_config:
        print(json.dumps(configuration_status(values), indent=2))
        return 0
    if args.live:
        # Default live limits are deliberately smaller than offline coverage.
        args.max_requests = min(args.max_requests, 8)
        args.max_output_tokens = min(args.max_output_tokens, 128000)
    selected = args.case or (["full_low"] if args.live else [case.id for case in CASES])
    cases = [next(case for case in CASES if case.id == identifier) for identifier in selected]
    try:
        report = asyncio.run(run_cases(cases, values, args))
    except Exception as error:
        print(json.dumps({"status": "blocked", "error_type": type(error).__name__, "configuration_available": configuration_status(values)}))
        return 2
    encoded = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    print(encoded, end="")
    return 0 if len(report["results"]) == len(cases) and all(row["status"] == "passed" for row in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
