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
    keys = worker._pipeline_model_settings(None)
    assert keys["_repair_model"] == model_config.route("repair_writer").model
    assert keys["_audit_fallback_model"] == model_config.route("audit_escalation").fallback
    assert keys["_jev_audit_model"] == model_config.route("claim_audit").model
    assert worker._resolve_generation_models({}, None, operation="generation") == (
        model_config.route("resume_writer").model, model_config.route("resume_writer").fallback)
