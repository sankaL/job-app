from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from arq.connections import RedisSettings
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettingsEnv(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_dev_mode: bool = False
    redis_url: str = "redis://localhost:6379/0"
    backend_api_url: str = "http://backend:8000"
    shared_contract_path: str = "/workspace/shared/workflow-contract.json"


def load_workflow_contract() -> dict[str, Any]:
    settings = WorkerSettingsEnv()
    contract_path = Path(settings.shared_contract_path)
    if not contract_path.exists():
        contract_path = Path(__file__).resolve().parents[1] / "shared" / "workflow-contract.json"
    return json.loads(contract_path.read_text())


@dataclass
class JobProgress:
    job_id: str
    workflow_kind: str
    state: str
    message: str
    percent_complete: int
    created_at: str
    updated_at: str
    completed_at: str | None = None
    terminal_error_code: str | None = None


async def report_bootstrap_progress(ctx: dict[str, Any]) -> dict[str, Any]:
    contract = load_workflow_contract()
    progress = JobProgress(
        job_id="phase-0-bootstrap",
        workflow_kind=contract["workflow_kinds"][0],
        state=contract["internal_states"][0],
        message="Worker baseline is online and ready for extraction jobs.",
        percent_complete=5,
        created_at=datetime.now(UTC).isoformat(),
        updated_at=datetime.now(UTC).isoformat(),
    )
    return asdict(progress)


class WorkerSettings:
    functions = [report_bootstrap_progress]
    redis_settings = RedisSettings.from_dsn(WorkerSettingsEnv().redis_url)
