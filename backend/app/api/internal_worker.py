from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import verify_worker_secret
from app.services.application_manager import (
    ApplicationService,
    WorkerCallbackPayload,
    get_application_service,
)

router = APIRouter(prefix="/api/internal/worker", tags=["internal-worker"])


@router.post("/extraction-callback")
async def extraction_callback(
    payload: WorkerCallbackPayload,
    _: Annotated[None, Depends(verify_worker_secret)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> dict[str, str]:
    try:
        await service.handle_worker_callback(payload)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return {"status": "accepted"}
