from __future__ import annotations

import hashlib
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db.profiles import ProfileRepository, get_profile_repository


def verify_worker_secret(
    worker_secret: Annotated[Optional[str], Header(alias="X-Worker-Secret")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    configured_secret = settings.worker_callback_secret
    if not configured_secret or worker_secret != configured_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid worker credentials.",
        )


class ExtensionAuthenticatedUser(BaseModel):
    id: str
    email: Optional[str] = None


def hash_extension_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_extension_token(
    extension_token: Annotated[Optional[str], Header(alias="X-Extension-Token")] = None,
    repository: ProfileRepository = Depends(get_profile_repository),
) -> ExtensionAuthenticatedUser:
    if not extension_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing extension token.",
        )

    token_hash = hash_extension_token(extension_token.strip())
    owner = repository.fetch_extension_owner_by_token_hash(token_hash)
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid extension token.",
        )
    if not owner.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact an administrator.",
        )

    repository.touch_extension_token(user_id=owner.id)
    return ExtensionAuthenticatedUser(id=owner.id, email=owner.email)
