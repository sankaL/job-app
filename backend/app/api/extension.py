from __future__ import annotations

import secrets
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl, field_validator

from app.api.applications import ApplicationDetail, to_application_detail
from app.core.auth import AuthenticatedUser, get_current_user
from app.core.security import (
    ExtensionAuthenticatedUser,
    hash_extension_token,
    verify_extension_token,
)
from app.db.profiles import (
    ExtensionConnectionRecord,
    ProfileRepository,
    get_profile_repository,
)
from app.services.application_manager import (
    ApplicationService,
    SourceCapturePayload,
    get_application_service,
)

router = APIRouter(prefix="/api/extension", tags=["extension"])


class ExtensionConnectionStatus(BaseModel):
    connected: bool
    token_created_at: Optional[str]
    token_last_used_at: Optional[str]


class ExtensionTokenResponse(BaseModel):
    token: str
    status: ExtensionConnectionStatus


class ExtensionCapturedApplicationRequest(BaseModel):
    job_url: HttpUrl
    source_text: str
    page_title: Optional[str] = None
    source_url: Optional[HttpUrl] = None
    meta: dict[str, str] = Field(default_factory=dict)
    json_ld: list[str] = Field(default_factory=list)
    captured_at: Optional[str] = None

    @field_validator("source_text")
    @classmethod
    def require_source_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Source text cannot be blank.")
        return stripped

    @field_validator("page_title", "captured_at")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def _to_status(record: ExtensionConnectionRecord) -> ExtensionConnectionStatus:
    return ExtensionConnectionStatus.model_validate(record.model_dump())


def _map_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Extension request failed.")


@router.get("/status", response_model=ExtensionConnectionStatus)
def extension_status(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
) -> ExtensionConnectionStatus:
    record = repository.fetch_extension_connection(current_user.id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authenticated profile is unavailable.",
        )
    return _to_status(record)


@router.post("/token", response_model=ExtensionTokenResponse)
def issue_extension_token(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
) -> ExtensionTokenResponse:
    token = f"jabr_ext_{secrets.token_urlsafe(32)}"
    record = repository.upsert_extension_token(
        user_id=current_user.id,
        token_hash=hash_extension_token(token),
    )
    return ExtensionTokenResponse(token=token, status=_to_status(record))


@router.delete("/token", response_model=ExtensionConnectionStatus)
def revoke_extension_token(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
) -> ExtensionConnectionStatus:
    return _to_status(repository.clear_extension_token(user_id=current_user.id))


@router.post("/import", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
async def import_captured_application(
    request: ExtensionCapturedApplicationRequest,
    extension_user: Annotated[ExtensionAuthenticatedUser, Depends(verify_extension_token)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        record = await service.create_application_from_capture(
            user_id=extension_user.id,
            job_url=str(request.job_url),
            capture=SourceCapturePayload(
                source_text=request.source_text,
                source_url=str(request.source_url) if request.source_url else str(request.job_url),
                page_title=request.page_title,
                meta=request.meta,
                json_ld=request.json_ld,
                captured_at=request.captured_at,
            ),
        )
        return to_application_detail(
            await service.get_application_detail(
                user_id=extension_user.id,
                application_id=record.id,
            )
        )
    except Exception as error:
        raise _map_error(error) from error
