"""Role-based model configuration shared by the backend and worker.

The canonical file is ``shared/model-config.json``; each service bundles an exact
copy because Railway builds services from their own directories (tests enforce
the copies match). Models are chosen by role, never by environment variable.
Secrets stay in the environment.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

ROLES = (
    "resume_writer", "section_writer", "repair_writer", "claim_audit", "audit_escalation",
    "job_extraction", "keyword_extraction", "resume_judge", "resume_import", "import_section_classification",
)
BUNDLED_PATH = Path(__file__).resolve().with_name("model-config.json")
_override: Optional["ModelConfig"] = None


class ModelProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api: Literal["chat", "decisions"] = "chat"
    # native_json: provider JSON-schema output; tool: forced tool call with temperature.
    output: Literal["native_json", "tool"] = "tool"
    reasoning: Optional[dict[str, Any]] = None
    providers: dict[str, Any] = Field(default_factory=dict)


class RoleRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = ""
    model: str = Field(min_length=1)
    fallback: Optional[str] = None
    enabled: bool = True


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    provider_defaults: dict[str, Any] = Field(default_factory=dict)
    models: dict[str, ModelProfile]
    roles: dict[str, RoleRoute]

    @model_validator(mode="after")
    def every_role_is_configured(self):
        missing = [role for role in ROLES if role not in self.roles]
        if missing:
            raise ValueError(f"Model config is missing roles: {', '.join(missing)}.")
        for name, route in self.roles.items():
            for model in filter(None, (route.model, route.fallback)):
                if model not in self.models:
                    raise ValueError(f"Role {name} uses {model}, which has no model profile.")
            if route.fallback and route.fallback == route.model:
                raise ValueError(f"Role {name} fallback must differ from its model.")
        return self


@lru_cache(maxsize=1)
def _load() -> ModelConfig:
    candidates = (BUNDLED_PATH, Path(__file__).resolve().parents[3] / "shared" / "model-config.json")
    path = next((candidate for candidate in candidates if candidate.exists()), None)
    if path is None:
        raise FileNotFoundError("model-config.json was not found next to the service or in shared/.")
    return ModelConfig.model_validate(json.loads(path.read_text()))


def get_model_config() -> ModelConfig:
    return _override or _load()


def route(role: str) -> RoleRoute:
    return get_model_config().roles[role]


def profile(model: str) -> ModelProfile:
    """Configured profile, or a conservative default for unconfigured (test) model names."""
    return get_model_config().models.get(model.removeprefix("~"), ModelProfile())


def provider_settings(model: str) -> dict[str, Any]:
    return {**get_model_config().provider_defaults, **profile(model).providers}


def set_override(config: Optional[ModelConfig]) -> None:
    """Tests only: replace the loaded configuration (None restores the file)."""
    global _override
    _override = config


def config_with_roles(**roles: tuple[str, Optional[str]]) -> ModelConfig:
    """Tests only: the file's configuration with some roles pointed at other model names."""
    base = _load().model_copy(deep=True)
    for role_name, (model, fallback) in roles.items():
        for name in filter(None, (model, fallback)):
            base.models.setdefault(name, ModelProfile())
        base.roles[role_name] = RoleRoute(model=model, fallback=fallback, enabled=base.roles[role_name].enabled)
    return ModelConfig.model_validate(base.model_dump())
