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


class GenerationJobQueue:
    def __init__(self, redis_url: str) -> None:
        self.redis_settings = RedisSettings.from_dsn(redis_url)

    async def enqueue(
        self,
        *,
        application_id: str,
        user_id: str,
        job_title: str,
        company_name: Optional[str],
        job_description: str,
        base_resume_content: str,
        personal_info: dict[str, Any],
        section_preferences: list[dict[str, Any]],
        generation_settings: dict[str, Any],
    ) -> str:
        job_id = uuid4().hex
        redis = await create_pool(self.redis_settings)
        try:
            result = await redis.enqueue_job(
                "run_generation_job",
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                base_resume_content=base_resume_content,
                personal_info=personal_info,
                section_preferences=section_preferences,
                generation_settings=generation_settings,
                _job_id=job_id,
            )
        finally:
            await redis.aclose()

        if result is None:
            raise RuntimeError("Failed to enqueue generation job.")

        return job_id

    async def enqueue_regeneration(
        self,
        *,
        application_id: str,
        user_id: str,
        job_title: str,
        company_name: Optional[str],
        job_description: str,
        base_resume_content: str,
        current_draft_content: str,
        personal_info: dict[str, Any],
        section_preferences: list[dict[str, Any]],
        generation_settings: dict[str, Any],
        regeneration_target: str,
        regeneration_instructions: Optional[str] = None,
    ) -> str:
        job_id = uuid4().hex
        redis = await create_pool(self.redis_settings)
        try:
            result = await redis.enqueue_job(
                "run_regeneration_job",
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                base_resume_content=base_resume_content,
                current_draft_content=current_draft_content,
                personal_info=personal_info,
                section_preferences=section_preferences,
                generation_settings=generation_settings,
                regeneration_target=regeneration_target,
                regeneration_instructions=regeneration_instructions,
                _job_id=job_id,
            )
        finally:
            await redis.aclose()

        if result is None:
            raise RuntimeError("Failed to enqueue regeneration job.")

        return job_id

    async def enqueue_resume_judge(
        self,
        *,
        application_id: str,
        user_id: str,
        job_title: str,
        company_name: Optional[str],
        job_description: str,
        base_resume_content: str,
        generated_resume_content: str,
        generation_settings: dict[str, Any],
        evaluated_draft_updated_at: str,
        job_context_signature: str,
    ) -> str:
        job_id = uuid4().hex
        redis = await create_pool(self.redis_settings)
        try:
            result = await redis.enqueue_job(
                "run_resume_judge_job",
                application_id=application_id,
                user_id=user_id,
                job_id=job_id,
                job_title=job_title,
                company_name=company_name,
                job_description=job_description,
                base_resume_content=base_resume_content,
                generated_resume_content=generated_resume_content,
                generation_settings=generation_settings,
                evaluated_draft_updated_at=evaluated_draft_updated_at,
                job_context_signature=job_context_signature,
                _job_id=job_id,
            )
        finally:
            await redis.aclose()

        if result is None:
            raise RuntimeError("Failed to enqueue Resume Judge job.")

        return job_id


def get_extraction_job_queue() -> ExtractionJobQueue:
    return ExtractionJobQueue(get_settings().redis_url)


def get_generation_job_queue() -> GenerationJobQueue:
    return GenerationJobQueue(get_settings().redis_url)
