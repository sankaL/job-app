from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.workflow_contract import WorkflowContract, get_workflow_contract
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository

router = APIRouter(prefix="/api/session", tags=["session"])


class UserPayload(BaseModel):
    id: str
    email: Optional[str]
    role: Optional[str]


class SessionBootstrapResponse(BaseModel):
    user: UserPayload
    profile: ProfileRecord
    workflow_contract_version: str


@router.get("/bootstrap", response_model=SessionBootstrapResponse)
def bootstrap_session(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    workflow_contract: Annotated[WorkflowContract, Depends(get_workflow_contract)],
) -> SessionBootstrapResponse:
    profile = repository.fetch_profile(current_user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authenticated profile is unavailable.",
        )

    return SessionBootstrapResponse(
        user=UserPayload(id=current_user.id, email=current_user.email, role=current_user.role),
        profile=profile,
        workflow_contract_version=workflow_contract.version,
    )
