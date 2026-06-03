from __future__ import annotations

import re
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from app.services.access_request_guard import (
    AccessRequestGuard,
    RateLimitExceededError,
    get_access_request_guard,
)
from app.services.access_requests import AccessRequestService, get_access_request_service

router = APIRouter(prefix="/api/public/access-requests", tags=["public-access-requests"])

EMAIL_PATTERN = re.compile(
    r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?"
    r"(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$",
    re.IGNORECASE,
)


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
        if not EMAIL_PATTERN.fullmatch(stripped):
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


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for.strip():
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop[:128]

    if request.client and request.client.host:
        return request.client.host[:128]

    return "unknown"


@router.post("", response_model=AccessRequestResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_access_request(
    http_request: Request,
    request: AccessRequestBody,
    service: Annotated[AccessRequestService, Depends(get_access_request_service)],
    guard: Annotated[AccessRequestGuard, Depends(get_access_request_guard)],
) -> AccessRequestResponse:
    try:
        guard_result = guard.start_request(
            client_ip=_client_ip(http_request),
            email=request.email,
        )
    except RateLimitExceededError as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many access requests from this client. Please try again later.",
            headers={"Retry-After": str(error.retry_after_seconds)},
        ) from error

    if guard_result.is_duplicate:
        return AccessRequestResponse(
            status="submitted",
            message="Access request submitted.",
        )

    try:
        await service.submit_request(
            full_name=request.full_name,
            email=request.email,
            interested_plan=request.interested_plan,
            note=request.note,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Access request processing is currently unavailable.",
        ) from error

    guard.mark_success(email=request.email)

    return AccessRequestResponse(
        status="submitted",
        message="Access request submitted.",
    )
