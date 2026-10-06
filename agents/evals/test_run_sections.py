from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evals.fixtures import CASES
from evals.run_sections import EvaluationLimit, RunMeter, configuration_status, diagnostic_error_messages, run_cases, safe_diagnostics, unsupported_term_present
from section_generation import SectionGenerationError


def arguments(**overrides):
    values = dict(live=False, max_requests=64, max_output_tokens=1024000,
        max_seconds=30, max_cost_usd=Decimal("1"), save_documents=False)
    return argparse.Namespace(**{**values, **overrides})


def test_named_factual_traps_use_lexical_boundaries():
    assert not unsupported_term_present("Trusted API documentation.")
    assert unsupported_term_present("Built services with Rust.")
    assert unsupported_term_present("Used Kubernetes clusters.")


def test_failure_report_preserves_only_safe_codes_and_ids():
    error = SectionGenerationError({"experience": "unsupported_technology,unsupported_metric"}, [])
    assert safe_diagnostics(error) == {"validation_errors": [{"section": "experience",
        "type": "unsupported_technology,unsupported_metric"}]}
    error.validation_errors.append({"type": "private user input", "section": "contact@example.test"})
    assert len(safe_diagnostics(error)["validation_errors"]) == 1


def test_opt_in_error_messages_redact_credentials_models_facts_urls_and_echoes():
    body = {'error': {'message':'Invalid parameters for private-model: sk-secret-credential Bearer access-token, user@example.test; https://provider.test/x?key=secret',
        'metadata': {'raw': json.dumps({'error': {'message':'Fictional Cedar Labs rejected field: null'}})}}}
    messages = diagnostic_error_messages(body, ['private-model','Fictional Cedar Labs'])
    encoded = json.dumps(messages)
    assert 'private-model' not in encoded and 'Fictional Cedar Labs' not in encoded
    assert 'sk-secret' not in encoded and 'access-token' not in encoded and 'user@example.test' not in encoded
    assert '?key=' not in encoded and 'https://' not in encoded
    assert any('rejected field: null' in message for message in messages)
    echo = diagnostic_error_messages({'error': {'message':'Invalid parameter. "messages": [{"role":"user","content":"do not show these facts"}]}'}}, [])
    assert echo == ['Invalid parameter. [request content omitted]']
    assert diagnostic_error_messages({'message':'x' * 3000}, []) == ['[oversized provider message omitted]']


@pytest.mark.asyncio
async def test_error_message_diagnostics_are_absent_unless_explicitly_enabled():
    meter = RunMeter(live=True, max_requests=8, max_output_tokens=64000,
        max_seconds=10, max_cost_usd=Decimal('0.50'))
    meter.requests.append({})
    response = httpx.Response(400, json={'error': {'message':'Public request rejection reason'}})
    await meter.response_hook(response)
    assert 'diagnostic_error_messages' not in meter.requests[-1]
    meter.diagnostic_errors = True
    await meter.response_hook(response)
    assert meter.requests[-1]['diagnostic_error_messages'] == ['Public request rejection reason']


@pytest.mark.asyncio
async def test_all_synthetic_cases_use_real_runtime_without_network(monkeypatch):
    import langsmith_tracing as tracing
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_PROJECT", "ambient-project")
    monkeypatch.setenv("LANGSMITH_API_KEY", "ambient-key")
    monkeypatch.setattr(tracing, "_build_client", lambda *_args: pytest.fail("Offline evaluation created a telemetry client"))
    report = await run_cases(CASES, {}, arguments())
    assert len(report["results"]) == len(CASES)
    for case in report["results"]:
        assert case["status"] == "passed", case
    # Parallel writer groups are written and audited separately (Experience vs other sections);
    # High writes and audits three stages in order (Experience, other sections, Skills and Summary).
    assert report["totals"]["requests"] == 30
    assert report["totals"]["schema_correction_requests"] == 1
    assert report["totals"]["section_repair_calls"] == 2
    assert report["totals"]["cost_kind"] == "synthetic_fixture"
    assert report["totals"]["reserved_output_tokens"] <= report["limits"]["max_reserved_output_tokens"]
    assert "document" not in report["results"][0]


@pytest.mark.asyncio
async def test_run_request_and_output_limits_stop_without_unbounded_retries():
    args = arguments()
    args.max_requests = 1
    report = await run_cases(CASES[:1], {}, args)
    assert report["totals"]["requests"] == 1
    assert report["stop_reason"] == "run_request_limit"
    assert report["results"][0]["status"] == "failed"
    args.max_requests = 32
    args.max_output_tokens = 1000
    report = await run_cases(CASES[:1], {}, args)
    assert report["totals"]["reserved_output_tokens"] <= 1000
    assert report["results"][0]["status"] == "failed"


@pytest.mark.asyncio
async def test_live_requires_dev_mode_credentials_models_and_explicit_endpoint():
    args = arguments()
    args.live = True
    with pytest.raises(EvaluationLimit):
        await run_cases(CASES[:1], {}, args)
    status = configuration_status({"OPENROUTER_API_KEY": "private-secret-value", "APP_DEV_MODE": "true",
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1"})
    assert all(status.values())
    assert all(isinstance(value, bool) for value in status.values())
    assert "private" not in json.dumps(status)


@pytest.mark.asyncio
async def test_missing_or_excess_cost_metadata_stops_next_request():
    meter = RunMeter(live=True, max_requests=8, max_output_tokens=64000,
        max_seconds=10, max_cost_usd=Decimal("0.50"))
    meter.requests.append({})
    response = httpx.Response(200, json={"usage": {"prompt_tokens": 10, "completion_tokens": 20}})
    await meter.response_hook(response)
    with pytest.raises(EvaluationLimit, match="provider_cost_metadata_missing"):
        meter.check()
    assert meter.requests[-1]["cost_usd"] is None
    meter.cost_missing = False
    await meter.response_hook(httpx.Response(200, json={"usage": {"cost": 0.75}}))
    with pytest.raises(EvaluationLimit, match="run_cost_stop_threshold"):
        meter.check()


@pytest.mark.asyncio
async def test_http_error_metrics_keep_categories_without_provider_body():
    meter = RunMeter(live=True, max_requests=8, max_output_tokens=64000,
        max_seconds=10, max_cost_usd=Decimal("0.50"))
    meter.requests.append({})
    await meter.response_hook(httpx.Response(400, json={"error": {
        "message": "Invalid schema: strict requires required properties; nullable unsupported. private@example.test",
        "code": "arbitrary-sensitive-code",
    }}))
    assert meter.requests[0]["provider_error_category"] == "strict_required"
    assert meter.requests[0]["http_status"] == 400
    assert "private@example.test" not in json.dumps(meter.requests)
    assert "arbitrary-sensitive-code" not in json.dumps(meter.requests)


@pytest.mark.asyncio
async def test_outbound_synthetic_contact_is_blocked_before_transport():
    meter = RunMeter(live=False, max_requests=8, max_output_tokens=64000,
        max_seconds=10, max_cost_usd=Decimal("0.50"))
    request = httpx.Request("POST", "https://synthetic.invalid/v1/chat/completions",
        json={"max_tokens": 8000, "messages": [{"role": "user", "content": "Morgan Synthetic"}]})
    with pytest.raises(EvaluationLimit, match="outbound_privacy_failed"):
        await meter.request_hook(request)
    assert not meter.requests


@pytest.mark.asyncio
async def test_live_evaluation_honors_env_file_project_and_tags_case(monkeypatch, tmp_path):
    from contextlib import contextmanager
    import langsmith_tracing as tracing
    from evals import run_sections as evaluator
    from evals.fixtures import source_document

    for key in ("LANGSMITH_TRACING", "LANGSMITH_PROJECT", "LANGSMITH_API_KEY", "LANGSMITH_WORKSPACE_ID"):
        monkeypatch.delenv(key, raising=False)
    env_file = tmp_path / "eval.env"
    env_file.write_text("LANGSMITH_TRACING=true\nLANGSMITH_PROJECT=eval-project\nLANGSMITH_API_KEY=eval-key\nLANGSMITH_WORKSPACE_ID=eval-workspace\n")
    values = {**evaluator.configuration(env_file), "APP_DEV_MODE": "true", "OPENROUTER_API_KEY": "provider-key",
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1"}
    captured = []
    @contextmanager
    def scope(name, **kwargs):
        captured.append({"name": name, "config": tracing._trace_config(), "workspace": tracing._TraceSettings().langsmith_workspace_id, **kwargs})
        yield None
    async def generate(**_kwargs):
        with evaluator.llm_runtime.trace_scope("applix.section_generation.pydantic_ai", metadata={"is_fallback": False}):
            pass
        return {"document": source_document()}
    monkeypatch.setattr(tracing, "trace_scope", scope)
    monkeypatch.setattr(evaluator.pipeline, "generate_document", generate)
    monkeypatch.setattr(evaluator, "assertions", lambda *_args: {"verified": True})
    report = await run_cases(CASES[:1], values, arguments(live=True))
    assert report["results"][0]["status"] == "passed"
    assert captured[0]["config"] == (True, "eval-key", "eval-project")
    assert captured[0]["workspace"] == "eval-workspace"
    assert captured[0]["metadata"]["evaluation"] is True
    assert captured[0]["metadata"]["case"] == CASES[0].id
    assert "evaluation" in captured[0]["tags"]
    assert tracing._trace_config() == (False, None, None)  # Scoped settings restored.
    assert "eval-key" not in json.dumps(report)


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["LANGSMITH_PROJECT", "LANGSMITH_API_KEY"])
async def test_live_tracing_missing_config_blocks_provider_work(monkeypatch, missing):
    from evals import run_sections as evaluator
    values = {"LANGSMITH_TRACING": "true", "LANGSMITH_PROJECT": "project", "LANGSMITH_API_KEY": "key",
        "APP_DEV_MODE": "true", "OPENROUTER_API_KEY": "provider-key", "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1"}
    del values[missing]
    async def unexpected(**_kwargs):
        pytest.fail("Invalid tracing configuration reached provider work")
    monkeypatch.setattr(evaluator.pipeline, "generate_document", unexpected)
    with pytest.raises(RuntimeError, match=missing):
        await run_cases(CASES[:1], values, arguments(live=True))
