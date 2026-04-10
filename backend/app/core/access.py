from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.config import Settings, get_settings
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository


def _maybe_bootstrap_admin(
    *,
    profile: ProfileRecord,
    current_user: AuthenticatedUser,
    repository: ProfileRepository,
    settings: Settings,
) -> ProfileRecord:
    email = (current_user.email or "").strip().lower()
    if not email:
        return profile

    if email not in set(settings.admin_email_list):
        return profile

    if profile.is_admin:
        return profile

    updated = repository.update_profile(
        user_id=current_user.id,
        updates={"is_admin": True},
    )
    return updated if updated is not None else profile


def get_current_profile(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ProfileRecord:
    profile = repository.fetch_profile(current_user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authenticated profile is unavailable.",
        )

    return _maybe_bootstrap_admin(
        profile=profile,
        current_user=current_user,
        repository=repository,
        settings=settings,
    )


def get_current_active_user(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    profile: Annotated[ProfileRecord, Depends(get_current_profile)],
) -> AuthenticatedUser:
    if not profile.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact an administrator.",
        )
    return current_user


def get_current_admin_user(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    profile: Annotated[ProfileRecord, Depends(get_current_profile)],
) -> AuthenticatedUser:
    if not profile.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is required.",
        )
    return current_user
