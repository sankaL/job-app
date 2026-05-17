from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.core.access import get_current_active_user, get_current_profile
from app.core.auth import AuthenticatedUser, get_current_user
from app.core.config import Settings, get_settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository
from app.db.users import UserRepository, get_user_repository

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginPayload(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MeResponse(BaseModel):
    id: str
    email: str


REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/auth"


def _refresh_cookie_samesite(settings: Settings) -> str:
    return "lax" if settings.is_local_dev_mode else "none"


def _set_refresh_cookie(*, response: Response, token: str, max_age: int, settings: Settings) -> None:
    secure = not settings.is_local_dev_mode
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=secure,
        samesite=_refresh_cookie_samesite(settings),
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
    )


def _issue_refresh_token(
    *,
    user_id: str,
    response: Response,
    user_repo: UserRepository,
    settings: Settings,
) -> None:
    raw_refresh = generate_refresh_token()
    token_hash = hash_token(raw_refresh)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    user_repo.create_refresh_token(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at.isoformat(),
    )
    _set_refresh_cookie(
        response=response,
        token=raw_refresh,
        max_age=settings.refresh_token_expire_days * 86400,
        settings=settings,
    )


@router.post("/login", response_model=LoginResponse)
def login(
    body: LoginPayload,
    response: Response,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    profile_repo: Annotated[ProfileRepository, Depends(get_profile_repository)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    normalized_email = body.email.strip().lower()

    if settings.is_local_dev_mode:
        return _login_dev(
            email=normalized_email,
            response=response,
            user_repo=user_repo,
            profile_repo=profile_repo,
            settings=settings,
        )

    user = user_repo.fetch_user_by_email(email=normalized_email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated.")

    if not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        private_key=settings.jwt_private_key,
        expire_minutes=settings.access_token_expire_minutes,
    )

    _issue_refresh_token(
        user_id=user.id,
        response=response,
        user_repo=user_repo,
        settings=settings,
    )

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


def _login_dev(
    *,
    email: str,
    response: Response,
    user_repo: UserRepository,
    profile_repo: ProfileRepository,
    settings: Settings,
) -> LoginResponse:
    user = user_repo.fetch_user_by_email(email=email)
    if user is None:
        user = user_repo.create_user(email=email, password_hash=hash_password(email))
        profile_repo.upsert_profile(user_id=user.id, updates={"email": email})

    existing = profile_repo.fetch_profile(user.id)
    if existing is None:
        profile_repo.upsert_profile(user_id=user.id, updates={"email": email})

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated.")

    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        private_key=settings.jwt_private_key,
        expire_minutes=settings.access_token_expire_minutes,
    )

    _issue_refresh_token(
        user_id=user.id,
        response=response,
        user_repo=user_repo,
        settings=settings,
    )

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    request: Request,
    response: Response,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    raw_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is missing.")

    token_hash = hash_token(raw_refresh)
    stored = user_repo.fetch_refresh_token(token_hash=token_hash)
    if stored is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token not found.")

    if stored.revoked_at is not None:
        user_repo.revoke_all_user_tokens(user_id=stored.user_id)
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token has been revoked.")

    expires_at = datetime.fromisoformat(stored.expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token has expired.")

    user = user_repo.fetch_user_by_id(user_id=stored.user_id)
    if user is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    if not user.is_active:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated.")

    user_repo.revoke_refresh_token(token_hash=token_hash)

    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        private_key=settings.jwt_private_key,
        expire_minutes=settings.access_token_expire_minutes,
    )

    new_raw_refresh = generate_refresh_token()
    new_token_hash = hash_token(new_raw_refresh)
    new_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    user_repo.rotate_refresh_token(
        old_token_hash=token_hash,
        user_id=user.id,
        new_token_hash=new_token_hash,
        expires_at=new_expires_at.isoformat(),
    )
    _set_refresh_cookie(
        response=response,
        token=new_raw_refresh,
        max_age=settings.refresh_token_expire_days * 86400,
        settings=settings,
    )

    return RefreshResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
):
    raw_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_refresh:
        token_hash = hash_token(raw_refresh)
        user_repo.revoke_refresh_token(token_hash=token_hash)

    _clear_refresh_cookie(response)
    return {"status": "ok"}


@router.get("/me", response_model=MeResponse)
def get_me(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    profile: Annotated[ProfileRecord, Depends(get_current_profile)],
):
    return MeResponse(
        id=current_user.id,
        email=current_user.email or "",
    )
