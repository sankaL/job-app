from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.core.access import get_current_active_user
from app.core.auth import AuthenticatedUser
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository

router = APIRouter(prefix="/api/profiles", tags=["profiles"])
logger = logging.getLogger(__name__)

VALID_SECTIONS = {"summary", "professional_experience", "education", "skills"}


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    linkedin_url: Optional[str] = None
    section_preferences: Optional[dict[str, bool]] = None
    section_order: Optional[list[str]] = None

    @field_validator("name", "phone", "address", "linkedin_url")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("section_preferences")
    @classmethod
    def validate_section_preferences(cls, value: Optional[dict[str, bool]]) -> Optional[dict[str, bool]]:
        if value is None:
            return None
        invalid_keys = set(value.keys()) - VALID_SECTIONS
        if invalid_keys:
            raise ValueError(f"Invalid section keys: {invalid_keys}. Valid keys: {VALID_SECTIONS}")
        return value

    @field_validator("section_order")
    @classmethod
    def validate_section_order(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        invalid_values = set(value) - VALID_SECTIONS
        if invalid_values:
            raise ValueError(f"Invalid section values: {invalid_values}. Valid values: {VALID_SECTIONS}")
        if len(value) != len(set(value)):
            raise ValueError("section_order must not contain duplicates.")
        return value


class ProfileResponse(BaseModel):
    id: str
    email: str
    first_name: Optional[str]
    last_name: Optional[str]
    name: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    linkedin_url: Optional[str]
    is_admin: bool
    is_active: bool
    onboarding_completed_at: Optional[str]
    default_base_resume_id: Optional[str]
    section_preferences: dict[str, bool]
    section_order: list[str]
    created_at: str
    updated_at: str


def _map_service_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, PermissionError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Profile request failed.")


@router.get("", response_model=ProfileResponse)
async def get_profile(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
) -> ProfileResponse:
    profile = repository.fetch_profile(current_user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )
    return ProfileResponse.model_validate(profile.model_dump())


@router.patch("", response_model=ProfileResponse)
async def patch_profile(
    request: UpdateProfileRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
) -> ProfileResponse:
    updates = request.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No profile updates provided.")
    try:
        updated = repository.update_profile(
            user_id=current_user.id,
            updates=updates,
        )
        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Profile not found.",
            )
        return ProfileResponse.model_validate(updated.model_dump())
    except Exception as error:
        logger.error(
            "Profile update failed. error_type=%s update_fields=%s",
            type(error).__name__,
            sorted(updates.keys()),
        )
        raise _map_service_error(error) from error
