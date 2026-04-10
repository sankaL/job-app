from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.config import get_settings


class ProgressRecord(BaseModel):
    job_id: str
    workflow_kind: str
    state: str
    message: str
    percent_complete: int
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None
    terminal_error_code: Optional[str] = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_progress(
    *,
    job_id: str,
    state: str,
    message: str,
    percent_complete: int,
    workflow_kind: str = "extraction",
    completed_at: Optional[str] = None,
    terminal_error_code: Optional[str] = None,
    created_at: Optional[str] = None,
) -> ProgressRecord:
    return ProgressRecord(
        job_id=job_id,
        workflow_kind=workflow_kind,
        state=state,
        message=message,
        percent_complete=percent_complete,
        created_at=created_at or now_iso(),
        updated_at=now_iso(),
        completed_at=completed_at,
        terminal_error_code=terminal_error_code,
    )


class RedisProgressStore:
    def __init__(self, redis_url: str) -> None:
        self._redis = Redis.from_url(redis_url, encoding="utf-8", decode_responses=True)

    @staticmethod
    def _key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:progress"

    async def get(self, application_id: str) -> Optional[ProgressRecord]:
        payload = await self._redis.get(self._key(application_id))
        if payload is None:
            return None
        return ProgressRecord.model_validate(json.loads(payload))

    async def set(
        self,
        application_id: str,
        progress: ProgressRecord,
        *,
        ttl_seconds: int = 86400,
    ) -> None:
        await self._redis.set(self._key(application_id), progress.model_dump_json(), ex=ttl_seconds)

    async def delete(self, application_id: str) -> None:
        await self._redis.delete(self._key(application_id))


def get_progress_store() -> RedisProgressStore:
    return RedisProgressStore(get_settings().redis_url)
