"""Test helper: build worker settings while pointing model roles at fake model names."""
from __future__ import annotations

import model_config
from worker import WorkerSettingsEnv

TIER2_ROLES = ("section_writer", "job_extraction", "keyword_extraction", "resume_judge")


def worker_settings(**kwargs):
    """Accepts legacy tier kwargs in tests and maps them onto roles in model-config.json."""
    tier1 = (kwargs.pop("tier1_model", None), kwargs.pop("tier1_fallback_model", None))
    tier2 = (kwargs.pop("tier2_model", None), kwargs.pop("tier2_fallback_model", None))
    roles = {}
    if tier1[0]:
        roles["resume_writer"] = tier1
    if tier2[0]:
        roles.update({role: tier2 for role in TIER2_ROLES})
    if roles:
        model_config.set_override(model_config.config_with_roles(**roles))
    return WorkerSettingsEnv(**kwargs)
