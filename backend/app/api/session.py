from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.access import get_current_active_user, get_current_profile
from app.core.auth import AuthenticatedUser
from app.core.workflow_contract import WorkflowContract, get_workflow_contract
from app.db.profiles import ProfileRecord

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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    profile: Annotated[ProfileRecord, Depends(get_current_profile)],
    workflow_contract: Annotated[WorkflowContract, Depends(get_workflow_contract)],
) -> SessionBootstrapResponse:
    return SessionBootstrapResponse(
        user=UserPayload(id=current_user.id, email=current_user.email, role=current_user.role),
        profile=profile,
        workflow_contract_version=workflow_contract.version,
    )
