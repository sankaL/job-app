from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Depends
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db.base_resumes import BaseResumeListRecord, BaseResumeRecord, BaseResumeRepository
from app.db.profiles import ProfileRepository


class ResumeWithDefaultFlag(BaseModel):
    id: str
    name: str
    user_id: str
    created_at: str
    updated_at: str
    is_default: bool


class ResumeDetailWithDefaultFlag(BaseModel):
    id: str
    name: str
    user_id: str
    content_md: str
    created_at: str
    updated_at: str
    is_default: bool


class BaseResumeService:
    def __init__(
        self,
        repo: BaseResumeRepository,
        profile_repo: ProfileRepository,
    ) -> None:
        self.repo = repo
        self.profile_repo = profile_repo

    def _is_default(self, user_id: str, resume_id: str) -> bool:
        default_id = self.profile_repo.fetch_default_resume_id(user_id)
        return default_id == resume_id

    def list_resumes(self, user_id: str) -> list[ResumeWithDefaultFlag]:
        records = self.repo.list_resumes(user_id)
        return [
            ResumeWithDefaultFlag(
                **record.model_dump(),
                is_default=self._is_default(user_id, record.id),
            )
            for record in records
        ]

    def create_resume(
        self,
        user_id: str,
        name: str,
        content_md: str,
    ) -> ResumeDetailWithDefaultFlag:
        stripped_name = name.strip()
        if not stripped_name:
            raise ValueError("Resume name cannot be blank.")

        record = self.repo.create_resume(
            user_id=user_id,
            name=stripped_name,
            content_md=content_md,
        )
        return ResumeDetailWithDefaultFlag(
            **record.model_dump(),
            is_default=self._is_default(user_id, record.id),
        )

    def get_resume(self, user_id: str, resume_id: str) -> ResumeDetailWithDefaultFlag:
        record = self.repo.fetch_resume(user_id, resume_id)
        if record is None:
            raise LookupError("Base resume not found.")
        return ResumeDetailWithDefaultFlag(
            **record.model_dump(),
            is_default=self._is_default(user_id, record.id),
        )

    def update_resume(
        self,
        user_id: str,
        resume_id: str,
        updates: dict,
    ) -> ResumeDetailWithDefaultFlag:
        # Verify ownership by fetching first
        existing = self.repo.fetch_resume(user_id, resume_id)
        if existing is None:
            raise LookupError("Base resume not found.")

        # Validate name if provided
        if "name" in updates:
            stripped_name = updates["name"].strip()
            if not stripped_name:
                raise ValueError("Resume name cannot be blank.")
            updates["name"] = stripped_name

        record = self.repo.update_resume(resume_id, user_id, updates)
        return ResumeDetailWithDefaultFlag(
            **record.model_dump(),
            is_default=self._is_default(user_id, record.id),
        )

    def delete_resume(
        self,
        user_id: str,
        resume_id: str,
        force: bool = False,
    ) -> None:
        # Verify ownership
        existing = self.repo.fetch_resume(user_id, resume_id)
        if existing is None:
            raise LookupError("Base resume not found.")

        # Check if referenced by any applications
        if self.repo.is_referenced(resume_id, user_id):
            if not force:
                raise ValueError(
                    "This resume is referenced by one or more applications. "
                    "Use force=true to delete anyway."
                )

        self.repo.delete_resume(resume_id, user_id)

    def set_default(self, user_id: str, resume_id: str) -> ResumeWithDefaultFlag:
        # Verify resume exists and belongs to user
        record = self.repo.fetch_resume(user_id, resume_id)
        if record is None:
            raise LookupError("Base resume not found.")

        # Update profile's default_base_resume_id
        self.profile_repo.update_default_resume(user_id, resume_id)

        return ResumeWithDefaultFlag(
            **record.model_dump(),
            is_default=True,
        )


def get_base_resume_service(
    settings: Settings = Depends(get_settings),
) -> BaseResumeService:
    from app.db.base_resumes import get_base_resume_repository
    from app.db.profiles import get_profile_repository

    return BaseResumeService(
        repo=get_base_resume_repository(),
        profile_repo=get_profile_repository(),
    )
