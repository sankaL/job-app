from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from app.core.auth import AuthenticatedUser, get_current_user
from app.db.applications import ApplicationListRecord, ApplicationRecord, MatchedApplicationRecord
from app.services.application_manager import (
    ApplicationDetailPayload,
    ApplicationService,
    DuplicateWarningPayload,
    SourceCapturePayload,
    get_application_service,
)
from app.services.progress import ProgressRecord

router = APIRouter(prefix="/api/applications", tags=["applications"])


class CreateApplicationRequest(BaseModel):
    job_url: HttpUrl


class UpdateApplicationRequest(BaseModel):
    applied: Optional[bool] = None
    notes: Optional[str] = None
    job_title: Optional[str] = None
    company: Optional[str] = None
    job_description: Optional[str] = None
    job_posting_origin: Optional[str] = None
    job_posting_origin_other_text: Optional[str] = None
    base_resume_id: Optional[str] = None

    @field_validator("notes", "job_title", "company", "job_description", "job_posting_origin_other_text")
    @classmethod
    def normalize_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ManualEntryRequest(BaseModel):
    job_title: str
    company: str
    job_description: str
    job_posting_origin: Optional[str] = None
    job_posting_origin_other_text: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("job_title", "company", "job_description")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("job_posting_origin_other_text", "notes")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_other_origin(self) -> "ManualEntryRequest":
        if self.job_posting_origin == "other" and not self.job_posting_origin_other_text:
            raise ValueError("Other origin requires a label.")
        if self.job_posting_origin != "other":
            self.job_posting_origin_other_text = None
        return self


class DuplicateResolutionRequest(BaseModel):
    resolution: str

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, value: str) -> str:
        if value not in {"dismissed", "redirected"}:
            raise ValueError("Resolution must be dismissed or redirected.")
        return value


class MatchedApplicationResponse(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    visible_status: str


class DuplicateWarning(BaseModel):
    similarity_score: float
    matched_fields: list[str]
    match_basis: str
    matched_application: MatchedApplicationResponse


class ExtractionFailureDetails(BaseModel):
    kind: str
    provider: Optional[str]
    reference_id: Optional[str]
    blocked_url: Optional[str]
    detected_at: str


class ApplicationSummary(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_posting_origin: Optional[str]
    visible_status: str
    internal_state: str
    failure_reason: Optional[str]
    applied: bool
    duplicate_similarity_score: Optional[float]
    duplicate_resolution_status: Optional[str]
    duplicate_matched_application_id: Optional[str]
    created_at: str
    updated_at: str
    base_resume_name: Optional[str]
    has_action_required_notification: bool
    has_unresolved_duplicate: bool


class ApplicationDetail(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_description: Optional[str]
    extracted_reference_id: Optional[str]
    job_posting_origin: Optional[str]
    job_posting_origin_other_text: Optional[str]
    base_resume_id: Optional[str]
    base_resume_name: Optional[str]
    visible_status: str
    internal_state: str
    failure_reason: Optional[str]
    extraction_failure_details: Optional[ExtractionFailureDetails]
    applied: bool
    duplicate_similarity_score: Optional[float]
    duplicate_resolution_status: Optional[str]
    duplicate_matched_application_id: Optional[str]
    notes: Optional[str]
    created_at: str
    updated_at: str
    has_action_required_notification: bool
    duplicate_warning: Optional[DuplicateWarning]


class ExtractionProgress(BaseModel):
    job_id: str
    workflow_kind: str
    state: str
    message: str
    percent_complete: int
    created_at: str
    updated_at: str
    completed_at: Optional[str]
    terminal_error_code: Optional[str]


class RecoverFromSourceRequest(BaseModel):
    source_text: str
    source_url: Optional[HttpUrl] = None
    page_title: Optional[str] = None
    meta: dict[str, str] = Field(default_factory=dict)
    json_ld: list[str] = Field(default_factory=list)
    captured_at: Optional[str] = None

    @field_validator("source_text")
    @classmethod
    def require_non_blank_source_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Source text cannot be blank.")
        return stripped

    @field_validator("page_title", "captured_at")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def to_application_summary(record: ApplicationListRecord) -> ApplicationSummary:
    return ApplicationSummary(
        **record.model_dump(),
        has_unresolved_duplicate=record.duplicate_resolution_status == "pending",
    )


def to_duplicate_warning(payload: Optional[DuplicateWarningPayload]) -> Optional[DuplicateWarning]:
    if payload is None:
        return None
    return DuplicateWarning(
        similarity_score=payload.similarity_score,
        matched_fields=payload.matched_fields,
        match_basis=payload.match_basis,
        matched_application=MatchedApplicationResponse.model_validate(
            payload.matched_application.model_dump()
        ),
    )


def to_application_detail(payload: ApplicationDetailPayload) -> ApplicationDetail:
    record = payload.application
    return ApplicationDetail(
        **record.model_dump(
            exclude={"exported_at", "duplicate_match_fields", "extraction_failure_details"},
        ),
        extraction_failure_details=(
            ExtractionFailureDetails.model_validate(record.extraction_failure_details)
            if record.extraction_failure_details
            else None
        ),
        duplicate_warning=to_duplicate_warning(payload.duplicate_warning),
    )


def _map_service_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, PermissionError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Application request failed.")


@router.get("", response_model=list[ApplicationSummary])
async def list_applications(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
    search: Optional[str] = Query(default=None),
    visible_status: Optional[str] = Query(default=None),
) -> list[ApplicationSummary]:
    records = await service.list_applications(
        user_id=current_user.id,
        search=search,
        visible_status=visible_status,
    )
    return [to_application_summary(record) for record in records]


@router.post("", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
async def create_application(
    request: CreateApplicationRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        record = await service.create_application(
            user_id=current_user.id,
            job_url=str(request.job_url),
        )
        return to_application_detail(
            await service.get_application_detail(
                user_id=current_user.id,
                application_id=record.id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{application_id}", response_model=ApplicationDetail)
async def get_application_detail(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.get_application_detail(
                user_id=current_user.id,
                application_id=application_id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.patch("/{application_id}", response_model=ApplicationDetail)
async def patch_application(
    application_id: str,
    request: UpdateApplicationRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    updates = request.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No application updates provided.")
    try:
        return to_application_detail(
            await service.patch_application(
                user_id=current_user.id,
                application_id=application_id,
                updates=updates,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/retry-extraction", response_model=ApplicationDetail)
async def retry_extraction(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.retry_extraction(
                user_id=current_user.id,
                application_id=application_id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/manual-entry", response_model=ApplicationDetail)
async def submit_manual_entry(
    application_id: str,
    request: ManualEntryRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.complete_manual_entry(
                user_id=current_user.id,
                application_id=application_id,
                updates=request.model_dump(),
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/recover-from-source", response_model=ApplicationDetail)
async def recover_from_source(
    application_id: str,
    request: RecoverFromSourceRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        capture = SourceCapturePayload(
            source_text=request.source_text,
            source_url=str(request.source_url) if request.source_url else None,
            page_title=request.page_title,
            meta=request.meta,
            json_ld=request.json_ld,
            captured_at=request.captured_at,
        )
        return to_application_detail(
            await service.recover_from_source(
                user_id=current_user.id,
                application_id=application_id,
                capture=capture,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/duplicate-resolution", response_model=ApplicationDetail)
async def resolve_duplicate(
    application_id: str,
    request: DuplicateResolutionRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.resolve_duplicate(
                user_id=current_user.id,
                application_id=application_id,
                resolution=request.resolution,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{application_id}/progress", response_model=ExtractionProgress)
async def get_progress(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ExtractionProgress:
    try:
        progress = await service.get_progress(
            user_id=current_user.id,
            application_id=application_id,
        )
        return ExtractionProgress.model_validate(progress.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error
