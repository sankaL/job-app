from __future__ import annotations

import json
from pathlib import Path

import pytest

import model_config

REPO = Path(__file__).resolve().parents[2]


def test_bundled_model_config_matches_shared_copy():
    shared = next((path for path in (REPO / "shared" / "model-config.json", Path("/workspace/shared/model-config.json"))
                   if path.exists()), Path("/missing"))
    if not shared.exists():  # Railway builds only the agents directory.
        pytest.skip("shared/ is not available in this build context")
    assert json.loads(model_config.BUNDLED_PATH.read_text()) == json.loads(shared.read_text()), (
        "agents/model-config.json drifted; copy shared/model-config.json into the agents and backend")


def test_every_role_resolves_to_a_profiled_model():
    config = model_config.get_model_config()
    assert set(model_config.ROLES) <= set(config.roles)
    for name, route in config.roles.items():
        assert route.model in config.models, name


def test_pipeline_routing_keys_come_from_roles():
    import worker
    keys = worker._pipeline_model_settings()
    assert keys["_repair_model"] == model_config.route("repair_writer").model
    assert keys["_audit_fallback_model"] == model_config.route("audit_escalation").fallback
    assert keys["_jev_audit_model"] == model_config.route("claim_audit").model
    assert worker._resolve_generation_models(operation="generation") == (
        model_config.route("resume_writer").model, model_config.route("resume_writer").fallback)


HAIKU, SONNET, SOL = "anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-5.6-sol"
LUNA = "openai/gpt-6-luna"


# Routing chosen from the 2026-10-12 bake-off.
@pytest.mark.parametrize("aggressiveness,writer,section", [
    (None, SONNET, LUNA), ("low", SONNET, LUNA), ("Medium", SONNET, LUNA), ("high", HAIKU, SONNET)])
def test_writers_route_by_aggressiveness(aggressiveness, writer, section):
    import worker
    assert worker._resolve_generation_models(operation="generation", aggressiveness=aggressiveness) == (writer, SOL)
    assert worker._resolve_generation_models(operation="regeneration_full", aggressiveness=aggressiveness) == (writer, SOL)
    assert worker._resolve_generation_models(operation="regeneration_section", aggressiveness=aggressiveness) == (section, HAIKU)
    keys = worker._pipeline_model_settings(aggressiveness)
    # Repairs follow the generation routing.
    assert (keys["_repair_model"], keys["_repair_fallback_model"]) == (writer, SOL)
    assert (keys["_routine_model"], keys["_routine_fallback_model"]) == (section, HAIKU)
    # The LLM audit keeps Sonnet at every level.
    assert keys["_audit_model"] == SONNET


@pytest.mark.parametrize("aggressiveness", [None, "low", "medium", "high"])
def test_keyword_optimization_uses_sonnet_separately_from_section_regeneration(aggressiveness):
    import worker
    assert worker._resolve_generation_models(operation="keyword_optimization", aggressiveness=aggressiveness) == (SONNET, SOL)
    if aggressiveness != "high":
        assert worker._resolve_generation_models(operation="regeneration_section", aggressiveness=aggressiveness)[0] == LUNA


def test_resume_judge_uses_haiku_with_luna_fallback():
    import worker
    assert worker._role_models("resume_judge") == (HAIKU, LUNA)


def test_writer_profiles_use_low_reasoning_and_standard_price_endpoints():
    config = model_config.get_model_config()
    for name in (SONNET, HAIKU, SOL, LUNA):
        profile = config.models[name]
        assert profile.output == "native_json"
        assert profile.reasoning == {"effort": "low", "exclude": True}
        tags = profile.providers.get("order", []) + profile.providers.get("only", [])
        assert tags and not any(tag.endswith("/fast") for tag in tags), name


def test_unknown_aggressiveness_fails_closed():
    with pytest.raises(ValueError, match="Unknown aggressiveness"):
        model_config.route("resume_writer", "extreme")


def _raw():
    return model_config.get_model_config().model_dump()


@pytest.mark.parametrize("mutate,message", [
    (lambda raw: raw["roles"].pop("resume_writer"), "missing roles"),
    (lambda raw: raw["roles"]["resume_writer"].update(fallback=raw["roles"]["resume_writer"]["model"]), "fallback must differ"),
    (lambda raw: raw["roles"]["resume_writer"].update(fallback="vendor/unprofiled"), "has no model profile"),
    (lambda raw: raw["roles"]["claim_audit"].update(model="anthropic/claude-sonnet-5.5"), "needs decisions models"),
    (lambda raw: raw["roles"]["resume_writer"].update(model="typesafe/jev-1.13"), "needs chat models"),
    (lambda raw: raw["roles"]["claim_audit"].update(fallback="anthropic/claude-sonnet-5.5"), "needs decisions models"),
    (lambda raw: raw["roles"]["resume_judge"].update(enabled=False), "cannot be disabled"),
    (lambda raw: raw["roles"]["job_extraction"].update(by_aggressiveness={"high": {"model": SONNET}}), "cannot route by aggressiveness"),
    (lambda raw: raw["roles"]["resume_writer"]["by_aggressiveness"].update(high={"model": "vendor/unprofiled"}), "has no model profile"),
    (lambda raw: raw["roles"]["resume_writer"]["by_aggressiveness"].update(high={"model": SOL}), "fallback must differ"),
    (lambda raw: raw["roles"]["resume_writer"]["by_aggressiveness"].update(extreme={"model": SONNET}), "by_aggressiveness"),
])
def test_invalid_configs_fail_closed(mutate, message):
    raw = _raw()
    mutate(raw)
    with pytest.raises(ValueError, match=message):
        model_config.ModelConfig.model_validate(raw)


def test_missing_or_malformed_config_file_fails_closed(tmp_path):
    with pytest.raises(FileNotFoundError, match="not found"):
        model_config.load_file(tmp_path / "absent.json")
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    with pytest.raises(ValueError, match="not valid JSON"):
        model_config.load_file(broken)
    assert model_config.load_file(model_config.BUNDLED_PATH).roles["resume_writer"].model


def test_removed_model_environment_variables_are_ignored(monkeypatch):
    import worker
    for name, value in (("TIER1_MODEL", "vendor/a"), ("TIER2_MODEL", "vendor/b"), ("JEV_AUDIT_MODEL", "vendor/c")):
        monkeypatch.setenv(name, value)
    worker.WorkerSettingsEnv()
    assert worker._role_models("resume_writer")[0] == "anthropic/claude-sonnet-5.5"
    assert worker._pipeline_model_settings()["_jev_audit_model"] == "typesafe/jev-1.13"
