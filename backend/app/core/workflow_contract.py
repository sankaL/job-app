from functools import lru_cache
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import get_settings


class MappingRule(BaseModel):
    name: str
    status: str
    when: dict[str, Any]


class PollingProgressSchema(BaseModel):
    required: list[str]
    properties: dict[str, str]


class WorkflowContract(BaseModel):
    version: str
    visible_statuses: list[dict[str, str]]
    internal_states: list[str]
    failure_reasons: list[str]
    workflow_kinds: list[str]
    mapping_rules: list[MappingRule]
    polling_progress_schema: PollingProgressSchema = Field(alias="polling_progress_schema")


@lru_cache
def get_workflow_contract() -> WorkflowContract:
    settings = get_settings()
    configured_path = Path(settings.shared_contract_path)
    bundled_path = Path(__file__).resolve().with_name("workflow-contract.json")
    fallback_paths = (
        bundled_path,
        Path(__file__).resolve().parents[2] / "shared" / "workflow-contract.json",
        Path(__file__).resolve().parents[3] / "shared" / "workflow-contract.json",
    )
    candidate_paths = (configured_path, *fallback_paths)

    contract_path = next((path for path in candidate_paths if path.exists()), None)
    if contract_path is None:
        raise FileNotFoundError(
            "Workflow contract file not found. Checked: "
            + ", ".join(str(path) for path in candidate_paths)
        )

    return WorkflowContract.model_validate(json.loads(contract_path.read_text()))
