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
# Roles answered by the OpenRouter Decisions API; every other role uses chat completions.
DECISIONS_ROLES = frozenset({"claim_audit", "import_section_classification"})
# Only the claim audit can be switched off (the LLM audit then checks every section).
OPTIONAL_ROLES = frozenset({"claim_audit"})
# Roles the worker resolves with the job's aggressiveness, so only they may route by level.
LEVEL_ROUTED_ROLES = frozenset({"resume_writer", "section_writer", "repair_writer", "audit_escalation"})
AGGRESSIVENESS_LEVELS = ("low", "medium", "high")
BUNDLED_PATH = Path(__file__).resolve().with_name("model-config.json")
_override: Optional["ModelConfig"] = None


class ModelProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api: Literal["chat", "decisions"] = "chat"
    # native_json: provider JSON-schema output; tool: forced tool call with temperature.
    output: Literal["native_json", "tool"] = "tool"
    reasoning: Optional[dict[str, Any]] = None
    providers: dict[str, Any] = Field(default_factory=dict)


class LevelRoute(BaseModel):
    """A role's model for one aggressiveness level; an omitted fallback keeps the role's fallback."""
    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1)
    fallback: Optional[str] = None


class RoleRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = ""
    model: str = Field(min_length=1)
    fallback: Optional[str] = None
    enabled: bool = True
    by_aggressiveness: dict[Literal["low", "medium", "high"], LevelRoute] = Field(default_factory=dict)

    def for_level(self, aggressiveness: Optional[str]) -> "RoleRoute":
        """The route for one aggressiveness level; no level (or no override) is the role's default route."""
        level = str(aggressiveness or "").strip().lower()
        if level and level not in AGGRESSIVENESS_LEVELS:
            raise ValueError("Unknown aggressiveness level for model routing.")
        override = self.by_aggressiveness.get(level) if level else None
        if override is None:
            return self
        return RoleRoute(description=self.description, model=override.model,
                         fallback=override.fallback or self.fallback, enabled=self.enabled)


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
        for name, role in self.roles.items():
            if role.by_aggressiveness and name not in LEVEL_ROUTED_ROLES:
                raise ValueError(f"Role {name} cannot route by aggressiveness.")
            for level in (None, *role.by_aggressiveness):
                route = role.for_level(level)
                for model in filter(None, (route.model, route.fallback)):
                    if model not in self.models:
                        raise ValueError(f"Role {name} uses {model}, which has no model profile.")
                if route.fallback and route.fallback == route.model:
                    raise ValueError(f"Role {name} fallback must differ from its model.")
                expected_api = "decisions" if name in DECISIONS_ROLES else "chat"
                if any(self.models[model].api != expected_api for model in filter(None, (route.model, route.fallback))):
                    raise ValueError(f"Role {name} needs {expected_api} models.")
                if name in DECISIONS_ROLES and route.fallback:
                    raise ValueError(f"Role {name} falls back to built-in behaviour; remove its fallback model.")
            if not role.enabled and name not in OPTIONAL_ROLES:
                raise ValueError(f"Role {name} cannot be disabled.")
        return self


def load_file(path: Path) -> ModelConfig:
    """Parse and validate one config file; any problem fails closed with a clear error."""
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        raise FileNotFoundError(f"Model config not found at {path}.") from None
    except json.JSONDecodeError as error:
        raise ValueError(f"Model config at {path} is not valid JSON (line {error.lineno}).") from None
    return ModelConfig.model_validate(raw)


@lru_cache(maxsize=1)
def _load() -> ModelConfig:
    # The bundled copy wins; a repository checkout can also fall back to shared/.
    candidates = (BUNDLED_PATH, *(parent / "shared" / "model-config.json" for parent in Path(__file__).resolve().parents))
    path = next((candidate for candidate in candidates if candidate.exists()), BUNDLED_PATH)
    return load_file(path)


def get_model_config() -> ModelConfig:
    return _override or _load()


def route(role: str, aggressiveness: Optional[str] = None) -> RoleRoute:
    """A role's route; level-routed roles pass the job's aggressiveness to apply any per-level override."""
    return get_model_config().roles[role].for_level(aggressiveness)


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
