from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.access_requests import AccessRequestService, get_access_request_service

router = APIRouter(prefix="/api/public/access-requests", tags=["public-access-requests"])


class AccessRequestBody(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    interested_plan: Literal["standard", "pro", "not_sure"]
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Full name is required.")
        return stripped

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        stripped = value.strip().lower()
        if "@" not in stripped or stripped.startswith("@") or stripped.endswith("@"):
            raise ValueError("Email is invalid.")
        return stripped

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class AccessRequestResponse(BaseModel):
    status: Literal["submitted"]
    message: str


def _map_error(error: Exception) -> HTTPException:
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Access request failed.",
    )


@router.post("", response_model=AccessRequestResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_access_request(
    request: AccessRequestBody,
    service: Annotated[AccessRequestService, Depends(get_access_request_service)],
) -> AccessRequestResponse:
    try:
        await service.submit_request(
            full_name=request.full_name,
            email=str(request.email),
            interested_plan=request.interested_plan,
            note=request.note,
        )
    except Exception as error:
        raise _map_error(error) from error

    return AccessRequestResponse(
        status="submitted",
        message="Access request submitted.",
    )
