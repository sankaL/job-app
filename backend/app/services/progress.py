from __future__ import annotations

import logging
import json
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)


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


class ApplicationEvent(BaseModel):
    event: str
    payload: dict[str, Any]


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

    @staticmethod
    def _extraction_result_key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:extracted"

    @staticmethod
    def _generation_result_key(application_id: str) -> str:
        return f"phase1:applications:{application_id}:generated"

    @staticmethod
    def _events_channel(application_id: str) -> str:
        return f"phase1:applications:{application_id}:events"

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
        try:
            await self.publish_event(
                application_id,
                ApplicationEvent(
                    event="progress",
                    payload=progress.model_dump(mode="json"),
                ),
            )
        except Exception:
            logger.warning("Failed publishing progress event for application %s", application_id, exc_info=True)

    async def delete(self, application_id: str) -> None:
        await self._redis.delete(self._key(application_id))

    async def get_extraction_result(self, application_id: str) -> Optional[dict[str, object]]:
        payload = await self._redis.get(self._extraction_result_key(application_id))
        if payload is None:
            return None
        return json.loads(payload)

    async def clear_extraction_result(self, application_id: str) -> None:
        await self._redis.delete(self._extraction_result_key(application_id))

    async def get_generation_result(self, application_id: str) -> Optional[dict[str, object]]:
        payload = await self._redis.get(self._generation_result_key(application_id))
        if payload is None:
            return None
        return json.loads(payload)

    async def consume_generation_result(self, application_id: str) -> Optional[dict[str, object]]:
        payload = await self._redis.getdel(self._generation_result_key(application_id))
        if payload is None:
            return None
        return json.loads(payload)

    async def clear_generation_result(self, application_id: str) -> None:
        await self._redis.delete(self._generation_result_key(application_id))

    async def publish_event(self, application_id: str, event: ApplicationEvent) -> None:
        await self._redis.publish(
            self._events_channel(application_id),
            event.model_dump_json(),
        )

    async def open_event_subscription(self, application_id: str):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(self._events_channel(application_id))
        return pubsub

    async def read_event(self, subscription, *, timeout_seconds: float = 1.0) -> Optional[ApplicationEvent]:
        message = await subscription.get_message(
            ignore_subscribe_messages=True,
            timeout=timeout_seconds,
        )
        if not message:
            return None

        payload = message.get("data")
        if payload is None:
            return None
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return ApplicationEvent.model_validate_json(payload)

    async def close_event_subscription(self, application_id: str, subscription) -> None:
        try:
            await subscription.unsubscribe(self._events_channel(application_id))
        finally:
            await subscription.close()


def get_progress_store() -> RedisProgressStore:
    return RedisProgressStore(get_settings().redis_url)
