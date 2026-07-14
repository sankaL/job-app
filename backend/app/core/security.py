from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db.profiles import ProfileRepository, get_profile_repository


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(
    *,
    user_id: str,
    email: str,
    private_key: str,
    expire_minutes: int = 15,
    issuer: str = "resume-builder",
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=expire_minutes),
        "type": "access",
        "iss": issuer,
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def decode_access_token(token: str, public_key: str, issuer: str = "resume-builder") -> dict[str, Any]:
    return jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        options={"verify_exp": True},
        issuer=issuer,
    )


def generate_refresh_token() -> str:
    return f"ref_{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_worker_secret(
    worker_secret: Annotated[Optional[str], Header(alias="X-Worker-Secret")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    configured_secret = settings.worker_callback_secret
    if (
        not configured_secret
        or not worker_secret
        or not secrets.compare_digest(worker_secret, configured_secret)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid worker credentials.",
        )


class ExtensionAuthenticatedUser(BaseModel):
    id: str
    email: Optional[str] = None


def verify_extension_token(
    extension_token: Annotated[Optional[str], Header(alias="X-Extension-Token")] = None,
    repository: ProfileRepository = Depends(get_profile_repository),
) -> ExtensionAuthenticatedUser:
    if not extension_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing extension token.",
        )

    token_hash = hash_token(extension_token.strip())
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
