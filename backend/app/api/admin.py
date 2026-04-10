from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, field_validator

from app.core.access import get_current_admin_user
from app.core.auth import AuthenticatedUser
from app.services.admin import (
    AdminMetricsPayload,
    AdminOperationMetric,
    AdminService,
    get_admin_service,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminOperationMetricResponse(BaseModel):
    total: int
    success_count: int
    failure_count: int
    success_rate: float


class AdminMetricsResponse(BaseModel):
    total_users: int
    active_users: int
    deactivated_users: int
    invited_users: int
    total_applications: int
    invites_sent: int
    invites_accepted: int
    invites_pending: int
    extraction: AdminOperationMetricResponse
    generation: AdminOperationMetricResponse
    regeneration: AdminOperationMetricResponse
    export: AdminOperationMetricResponse


class AdminUserResponse(BaseModel):
    id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    linkedin_url: Optional[str] = None
    is_admin: bool
    is_active: bool
    onboarding_completed_at: Optional[str] = None
    latest_invite_status: Optional[str] = None
    latest_invite_sent_at: Optional[str] = None
    latest_invite_expires_at: Optional[str] = None
    created_at: str
    updated_at: str


class InviteUserRequest(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        stripped = value.strip()
        if "@" not in stripped or stripped.startswith("@") or stripped.endswith("@"):
            raise ValueError("Email is invalid.")
        return stripped

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class InviteUserResponse(BaseModel):
    invite_id: str
    invitee_user_id: str
    invited_email: str
    expires_at: str


class UpdateAdminUserRequest(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    linkedin_url: Optional[str] = None

    @field_validator("first_name", "last_name", "phone", "address", "linkedin_url")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if "@" not in stripped or stripped.startswith("@") or stripped.endswith("@"):
            raise ValueError("Email is invalid.")
        return stripped


def _map_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, PermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Admin request failed.")


def _to_operation_metric(metric: AdminOperationMetric) -> AdminOperationMetricResponse:
    return AdminOperationMetricResponse.model_validate(metric.model_dump())


def _to_metrics_response(payload: AdminMetricsPayload) -> AdminMetricsResponse:
    return AdminMetricsResponse(
        total_users=payload.total_users,
        active_users=payload.active_users,
        deactivated_users=payload.deactivated_users,
        invited_users=payload.invited_users,
        total_applications=payload.total_applications,
        invites_sent=payload.invites_sent,
        invites_accepted=payload.invites_accepted,
        invites_pending=payload.invites_pending,
        extraction=_to_operation_metric(payload.extraction),
        generation=_to_operation_metric(payload.generation),
        regeneration=_to_operation_metric(payload.regeneration),
        export=_to_operation_metric(payload.export),
    )


@router.get("/metrics", response_model=AdminMetricsResponse)
def get_admin_metrics(
    _: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AdminMetricsResponse:
    return _to_metrics_response(service.get_metrics())


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    _: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
    search: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
) -> list[AdminUserResponse]:
    rows = service.list_users(search=search, status=status_filter)
    return [AdminUserResponse.model_validate(row.model_dump()) for row in rows]


@router.post("/users/invite", response_model=InviteUserResponse, status_code=status.HTTP_201_CREATED)
async def invite_user(
    request: InviteUserRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> InviteUserResponse:
    try:
        result = await service.invite_user(
            invited_by_user_id=current_user.id,
            email=str(request.email),
            first_name=request.first_name,
            last_name=request.last_name,
        )
        return InviteUserResponse.model_validate(result.model_dump())
    except Exception as error:
        raise _map_error(error) from error


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: str,
    request: UpdateAdminUserRequest,
    _: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AdminUserResponse:
    updates = request.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user updates provided.")
    try:
        updated = await service.update_user(target_user_id=user_id, updates=updates)
        return AdminUserResponse.model_validate(updated.model_dump())
    except Exception as error:
        raise _map_error(error) from error


@router.post("/users/{user_id}/deactivate", response_model=AdminUserResponse)
async def deactivate_user(
    user_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AdminUserResponse:
    try:
        updated = await service.deactivate_user(
            actor_user_id=current_user.id,
            target_user_id=user_id,
        )
        return AdminUserResponse.model_validate(updated.model_dump())
    except Exception as error:
        raise _map_error(error) from error


@router.post("/users/{user_id}/reactivate", response_model=AdminUserResponse)
async def reactivate_user(
    user_id: str,
    _: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> AdminUserResponse:
    try:
        updated = await service.reactivate_user(target_user_id=user_id)
        return AdminUserResponse.model_validate(updated.model_dump())
    except Exception as error:
        raise _map_error(error) from error


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_user(
    user_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_admin_user)],
    service: Annotated[AdminService, Depends(get_admin_service)],
) -> Response:
    try:
        await service.delete_user(actor_user_id=current_user.id, target_user_id=user_id)
    except Exception as error:
        raise _map_error(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)
