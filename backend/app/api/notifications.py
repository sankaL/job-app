from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from app.core.auth import AuthenticatedUser, get_current_user
from app.db.notifications import NotificationRepository, get_notification_repository

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationSummary(BaseModel):
    id: str
    application_id: Optional[str]
    type: str
    message: str
    action_required: bool
    read: bool
    created_at: str


@router.get("", response_model=list[NotificationSummary])
def list_notifications(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> list[NotificationSummary]:
    return [
        NotificationSummary.model_validate(record.model_dump())
        for record in repository.list_notifications(current_user.id)
    ]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_notifications(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repository: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> Response:
    repository.clear_notifications(current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
