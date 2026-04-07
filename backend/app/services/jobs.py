from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import get_settings


class ExtractionJobQueue:
    def __init__(self, redis_url: str) -> None:
        self.redis_settings = RedisSettings.from_dsn(redis_url)

    async def enqueue(
        self,
        *,
        application_id: str,
        user_id: str,
        job_url: str,
        source_capture: Optional[dict[str, Any]] = None,
    ) -> str:
        job_id = uuid4().hex
        redis = await create_pool(self.redis_settings)
        try:
            result = await redis.enqueue_job(
                "run_extraction_job",
                application_id=application_id,
                user_id=user_id,
                job_url=job_url,
                source_capture=source_capture,
                job_id=job_id,
                _job_id=job_id,
            )
        finally:
            await redis.aclose()

        if result is None:
            raise RuntimeError("Failed to enqueue extraction job.")

        return job_id


def get_extraction_job_queue() -> ExtractionJobQueue:
    return ExtractionJobQueue(get_settings().redis_url)
