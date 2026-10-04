from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core import model_config

REPO = Path(__file__).resolve().parents[2]


def test_bundled_model_config_matches_shared_copy():
    shared = next((path for path in (REPO / "shared" / "model-config.json", Path("/workspace/shared/model-config.json"))
                   if path.exists()), Path("/missing"))
    if not shared.exists():  # Railway builds only the backend directory.
        pytest.skip("shared/ is not available in this build context")
    assert json.loads(model_config.BUNDLED_PATH.read_text()) == json.loads(shared.read_text()), (
        "backend/app/core/model-config.json drifted; copy shared/model-config.json into the backend and agents")


def test_backend_roles_and_profiles_resolve():
    assert model_config.route("resume_import").fallback
    assert model_config.profile(model_config.route("resume_import").model).output == "native_json"
    assert model_config.profile(model_config.route("import_section_classification").model).api == "decisions"
    settings = model_config.provider_settings("google/gemini-3.8-flash")
    assert settings["data_collection"] == "deny" and settings["only"] == ["google-ai-studio"]


def test_unprofiled_role_model_fails_closed():
    raw = model_config.get_model_config().model_dump()
    raw["roles"]["resume_import"] = {"model": "vendor/unprofiled"}
    with pytest.raises(ValueError, match="has no model profile"):
        model_config.ModelConfig.model_validate(raw)


def test_backend_and_agents_copies_are_identical():
    agents = next((path for path in (REPO / "agents", Path("/agents")) if (path / "model_config.py").exists()), None)
    if agents is None:
        pytest.skip("agents/ is not available in this build context")
    assert (agents / "model_config.py").read_bytes() == Path(model_config.__file__).read_bytes(), (
        "backend/app/core/model_config.py must be byte-identical to agents/model_config.py")
    assert json.loads((agents / "model-config.json").read_text()) == json.loads(model_config.BUNDLED_PATH.read_text())
