from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.access import get_current_active_user
from app.core.auth import AuthenticatedUser
from app.services.export_styles import DEFAULT_EXPORT_STYLE, list_export_styles

router = APIRouter(prefix="/api/export-styles", tags=["export-styles"])


class ExportStyleOption(BaseModel):
    key: str
    label: str
    description: str
    is_default: bool


@router.get("", response_model=list[ExportStyleOption])
async def get_export_styles(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
) -> list[ExportStyleOption]:
    del current_user  # Authenticated surface only; the catalogue is the same for every user.
    return [
        ExportStyleOption(
            key=style.key,
            label=style.label,
            description=style.description,
            is_default=style.key == DEFAULT_EXPORT_STYLE,
        )
        for style in list_export_styles()
    ]
