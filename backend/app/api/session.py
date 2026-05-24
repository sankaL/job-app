from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.access import get_current_active_user, get_current_profile
from app.core.auth import AuthenticatedUser
from app.core.workflow_contract import WorkflowContract, get_workflow_contract
from app.db.applications import ApplicationRepository, ApplicationSummaryCountsRecord, get_application_repository
from app.db.profiles import ProfileRecord
from app.db.subscriptions import (
    GenerationQuotaStatusRecord,
    SubscriptionRepository,
    get_subscription_repository,
)

router = APIRouter(prefix="/api/session", tags=["session"])


class UserPayload(BaseModel):
    id: str
    email: Optional[str]
    role: Optional[str]


class SessionBootstrapResponse(BaseModel):
    user: UserPayload
    profile: ProfileRecord
    application_summary: ApplicationSummaryCountsRecord
    generation_quota: GenerationQuotaStatusRecord
    workflow_contract_version: str


@router.get("/bootstrap", response_model=SessionBootstrapResponse)
def bootstrap_session(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    profile: Annotated[ProfileRecord, Depends(get_current_profile)],
    application_repository: Annotated[ApplicationRepository, Depends(get_application_repository)],
    subscription_repository: Annotated[SubscriptionRepository, Depends(get_subscription_repository)],
    workflow_contract: Annotated[WorkflowContract, Depends(get_workflow_contract)],
) -> SessionBootstrapResponse:
    return SessionBootstrapResponse(
        user=UserPayload(id=current_user.id, email=current_user.email, role=current_user.role),
        profile=profile,
        application_summary=application_repository.fetch_summary_counts(current_user.id),
        generation_quota=subscription_repository.fetch_generation_quota_status(user_id=current_user.id),
        workflow_contract_version=workflow_contract.version,
    )
