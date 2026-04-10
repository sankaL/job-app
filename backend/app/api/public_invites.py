from __future__ import annotations

import re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator, model_validator

from app.services.admin import AdminService, InviteAcceptResult, InvitePreviewPayload, get_admin_service

router = APIRouter(prefix="/api/public/invites", tags=["public-invites"])

PASSWORD_MIN_LENGTH = 12
PASSWORD_UPPERCASE_PATTERN = re.compile(r"[A-Z]")
PASSWORD_LOWERCASE_PATTERN = re.compile(r"[a-z]")
PASSWORD_DIGIT_PATTERN = re.compile(r"\d")
PASSWORD_SYMBOL_PATTERN = re.compile(r"[^A-Za-z0-9]")


class InvitePreviewResponse(BaseModel):
    invited_email: str
    expires_at: str


class AcceptInviteRequest(BaseModel):
    token: str
    email: str
    password: str
    confirm_password: str
    first_name: str
    last_name: str
    phone: str
    address: str
    linkedin_url: Optional[str] = None

    @field_validator("token", "first_name", "last_name", "phone", "address")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("password", "confirm_password")
    @classmethod
    def require_password_non_blank(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Password is required.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if len(value) < PASSWORD_MIN_LENGTH:
            raise ValueError("Password must be at least 12 characters long.")
        if PASSWORD_UPPERCASE_PATTERN.search(value) is None:
            raise ValueError("Password must include at least one uppercase letter.")
        if PASSWORD_LOWERCASE_PATTERN.search(value) is None:
            raise ValueError("Password must include at least one lowercase letter.")
        if PASSWORD_DIGIT_PATTERN.search(value) is None:
            raise ValueError("Password must include at least one number.")
        if PASSWORD_SYMBOL_PATTERN.search(value) is None:
            raise ValueError("Password must include at least one special character.")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        stripped = value.strip()
        if "@" not in stripped or stripped.startswith("@") or stripped.endswith("@"):
            raise ValueError("Email is invalid.")
        return stripped

    @field_validator("linkedin_url")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_password_confirmation(self) -> "AcceptInviteRequest":
        if self.password != self.confirm_password:
            raise ValueError("Password confirmation does not match.")
        return self


class AcceptInviteResponse(BaseModel):
    user_id: str
    email: str


def _map_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, PermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invite request failed.")


@router.get("/preview", response_model=InvitePreviewResponse)
def preview_invite(
    token: Annotated[str, Query(min_length=1)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> InvitePreviewResponse:
    try:
        preview: InvitePreviewPayload = service.preview_invite(token=token)
        return InvitePreviewResponse.model_validate(preview.model_dump())
    except Exception as error:
        raise _map_error(error) from error


@router.post("/accept", response_model=AcceptInviteResponse)
async def accept_invite(
    request: AcceptInviteRequest,
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AcceptInviteResponse:
    try:
        accepted: InviteAcceptResult = await service.accept_invite(
            token=request.token,
            email=str(request.email),
            password=request.password,
            first_name=request.first_name,
            last_name=request.last_name,
            phone=request.phone,
            address=request.address,
            linkedin_url=request.linkedin_url,
        )
        return AcceptInviteResponse.model_validate(accepted.model_dump())
    except Exception as error:
        raise _map_error(error) from error
