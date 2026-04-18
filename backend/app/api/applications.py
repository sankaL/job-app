from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from app.core.access import get_current_active_user
from app.core.auth import AuthenticatedUser
from app.db.applications import ApplicationListRecord, ApplicationRecord, MatchedApplicationRecord
from app.db.resume_drafts import ResumeDraftRecord
from app.services.application_manager import (
    ApplicationDetailPayload,
    ApplicationService,
    DuplicateWarningPayload,
    ResumeJudgeResultPayload,
    SourceCapturePayload,
    get_application_service,
)
from app.services.progress import ProgressRecord, now_iso

router = APIRouter(prefix="/api/applications", tags=["applications"])
logger = logging.getLogger(__name__)
STREAM_HEARTBEAT_SECONDS = 15.0

INSTRUCTION_WHITESPACE_RE = re.compile(r"\s+")
UNSAFE_INSTRUCTION_PATTERNS = (
    re.compile(r"\b(ignore|disregard|override)\b.{0,40}\b(previous|prior|above|earlier)\b", re.I),
    re.compile(r"\b(make up|invent|fabricate|hallucinate)\b", re.I),
    re.compile(
        r"\b(add|insert|append)\b.{0,60}\b("
        r"degree|certification|certificate|credential|award|employer|date|dates|"
        r"phone|email|address|linkedin|website|url|harvard|stanford|mit"
        r")\b",
        re.I,
    ),
    re.compile(
        r"\binclude\b.{0,60}\b("
        r"degree|certification|certificate|credential|award|employer|date|dates|"
        r"phone|email|address|linkedin|website|url|harvard|stanford|mit"
        r")\b",
        re.I,
    ),
)


def _validate_generation_instruction_text(value: Optional[str], *, required: bool, field_label: str) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError(f"{field_label} are required.")
        return None

    stripped = value.strip()
    if not stripped:
        if required:
            raise ValueError(f"{field_label} are required.")
        return None

    policy_text = INSTRUCTION_WHITESPACE_RE.sub(" ", stripped)
    for pattern in UNSAFE_INSTRUCTION_PATTERNS:
        if pattern.search(policy_text):
            raise ValueError(
                f"{field_label} can refine tone, emphasis, prioritization, brevity, and keyword focus only."
            )

    return stripped


class CreateApplicationRequest(BaseModel):
    job_url: HttpUrl
    source_text: Optional[str] = None

    @field_validator("source_text")
    @classmethod
    def normalize_source_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class UpdateApplicationRequest(BaseModel):
    applied: Optional[bool] = None
    notes: Optional[str] = None
    job_title: Optional[str] = None
    company: Optional[str] = None
    job_description: Optional[str] = None
    job_location_text: Optional[str] = None
    compensation_text: Optional[str] = None
    job_posting_origin: Optional[str] = None
    job_posting_origin_other_text: Optional[str] = None
    base_resume_id: Optional[str] = None

    @field_validator("notes", "job_title", "company", "job_description", "job_location_text", "compensation_text", "job_posting_origin_other_text")
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
    job_location_text: Optional[str] = None
    compensation_text: Optional[str] = None
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

    @field_validator("job_location_text", "compensation_text", "job_posting_origin_other_text", "notes")
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


class GenerationFailureDetails(BaseModel):
    message: Optional[str] = None
    validation_errors: Optional[list[str]] = None


class ApplicationDetail(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_description: Optional[str]
    job_location_text: Optional[str]
    compensation_text: Optional[str]
    extracted_reference_id: Optional[str]
    job_posting_origin: Optional[str]
    job_posting_origin_other_text: Optional[str]
    base_resume_id: Optional[str]
    base_resume_name: Optional[str]
    visible_status: str
    internal_state: str
    failure_reason: Optional[str]
    extraction_failure_details: Optional[ExtractionFailureDetails]
    generation_failure_details: Optional[dict[str, Any]]
    resume_judge_result: Optional[ResumeJudgeResultPayload]
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


class GenerateResumeRequest(BaseModel):
    base_resume_id: str
    target_length: str = "1_page"
    aggressiveness: str = "medium"
    additional_instructions: Optional[str] = None

    @field_validator("base_resume_id")
    @classmethod
    def require_non_blank_resume_id(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Base resume ID is required.")
        return stripped

    @field_validator("target_length")
    @classmethod
    def validate_target_length(cls, value: str) -> str:
        if value not in {"1_page", "2_page", "3_page"}:
            raise ValueError("Target length must be 1_page, 2_page, or 3_page.")
        return value

    @field_validator("aggressiveness")
    @classmethod
    def validate_aggressiveness(cls, value: str) -> str:
        if value not in {"low", "medium", "high"}:
            raise ValueError("Aggressiveness must be low, medium, or high.")
        return value

    @field_validator("additional_instructions")
    @classmethod
    def normalize_instructions(cls, value: Optional[str]) -> Optional[str]:
        return _validate_generation_instruction_text(value, required=False, field_label="Additional instructions")


class FullRegenerationRequest(BaseModel):
    target_length: str = "1_page"
    aggressiveness: str = "medium"
    additional_instructions: Optional[str] = None

    @field_validator("target_length")
    @classmethod
    def validate_target_length(cls, value: str) -> str:
        if value not in {"1_page", "2_page", "3_page"}:
            raise ValueError("Target length must be 1_page, 2_page, or 3_page.")
        return value

    @field_validator("aggressiveness")
    @classmethod
    def validate_aggressiveness(cls, value: str) -> str:
        if value not in {"low", "medium", "high"}:
            raise ValueError("Aggressiveness must be low, medium, or high.")
        return value

    @field_validator("additional_instructions")
    @classmethod
    def normalize_instructions(cls, value: Optional[str]) -> Optional[str]:
        return _validate_generation_instruction_text(value, required=False, field_label="Additional instructions")


class SectionRegenerationRequest(BaseModel):
    section_name: str
    instructions: str

    @field_validator("section_name")
    @classmethod
    def require_non_blank_section(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Section name is required.")
        return stripped

    @field_validator("instructions")
    @classmethod
    def require_non_blank_instructions(cls, value: str) -> str:
        validated = _validate_generation_instruction_text(
            value,
            required=True,
            field_label="Instructions",
        )
        if validated is None:
            raise ValueError("Instructions are required for section regeneration.")
        return validated


class SaveDraftRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def require_non_blank_content(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Draft content cannot be blank.")
        return value


class ResumeDraftResponse(BaseModel):
    id: str
    application_id: str
    content_md: str
    generation_params: dict[str, Any]
    sections_snapshot: dict[str, Any]
    review_flags: list[dict[str, str]] = Field(default_factory=list)
    last_generated_at: str
    last_exported_at: Optional[str]
    updated_at: str


class WorkflowProgress(BaseModel):
    job_id: str
    workflow_kind: str
    state: str
    message: str
    percent_complete: int
    created_at: str
    updated_at: str
    completed_at: Optional[str]
    terminal_error_code: Optional[str]


class ApplicationEventSnapshot(BaseModel):
    detail: ApplicationDetail
    progress: Optional[WorkflowProgress]


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
            exclude={
                "exported_at",
                "duplicate_match_fields",
                "extraction_failure_details",
                "generation_failure_details",
                "resume_judge_result",
            },
        ),
        extraction_failure_details=(
            ExtractionFailureDetails.model_validate(record.extraction_failure_details)
            if record.extraction_failure_details
            else None
        ),
        generation_failure_details=record.generation_failure_details,
        resume_judge_result=(
            ResumeJudgeResultPayload.model_validate(record.resume_judge_result)
            if record.resume_judge_result
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
    logger.exception("Unhandled application service error.", exc_info=error)
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Application request failed.")


def _format_sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@router.get("", response_model=list[ApplicationSummary])
async def list_applications(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        if request.source_text:
            record = await service.create_application_from_capture(
                user_id=current_user.id,
                job_url=str(request.job_url),
                capture=SourceCapturePayload(
                    source_text=request.source_text,
                    source_url=str(request.job_url),
                ),
            )
        else:
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_application(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> Response:
    try:
        await service.delete_application(
            user_id=current_user.id,
            application_id=application_id,
        )
    except Exception as error:
        raise _map_service_error(error) from error

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{application_id}/cancel-extraction", response_model=ApplicationDetail)
async def cancel_extraction(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.cancel_extraction(
                user_id=current_user.id,
                application_id=application_id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/retry-extraction", response_model=ApplicationDetail)
async def retry_extraction(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
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


@router.get("/{application_id}/progress", response_model=WorkflowProgress)
async def get_progress(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> WorkflowProgress:
    try:
        progress = await service.get_progress(
            user_id=current_user.id,
            application_id=application_id,
        )
        return WorkflowProgress.model_validate(progress.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{application_id}/events")
async def stream_application_events(
    application_id: str,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> StreamingResponse:
    try:
        service._require_application(
            user_id=current_user.id,
            application_id=application_id,
        )
    except Exception as error:
        raise _map_service_error(error) from error

    async def event_stream():
        subscription = await service.progress_store.open_event_subscription(application_id)
        try:
            detail = to_application_detail(
                await service.get_application_detail(
                    user_id=current_user.id,
                    application_id=application_id,
                )
            )
            progress = WorkflowProgress.model_validate(
                (
                    await service.get_progress(
                        user_id=current_user.id,
                        application_id=application_id,
                    )
                ).model_dump()
            )
            snapshot = ApplicationEventSnapshot(detail=detail, progress=progress)
            yield _format_sse_event("snapshot", snapshot.model_dump(mode="json"))

            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await service.progress_store.read_event(
                        subscription,
                        timeout_seconds=STREAM_HEARTBEAT_SECONDS,
                    )
                except asyncio.CancelledError:
                    break
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    event = None
                if event is None:
                    yield _format_sse_event("heartbeat", {"sent_at": now_iso()})
                    continue
                yield _format_sse_event(event.event, event.payload)
        finally:
            await service.progress_store.close_event_subscription(application_id, subscription)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{application_id}/draft", response_model=Optional[ResumeDraftResponse])
async def get_draft(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> Optional[ResumeDraftResponse]:
    try:
        draft, review_flags = await service.get_draft_with_review_flags(
            user_id=current_user.id,
            application_id=application_id,
        )
        if draft is None:
            return None
        payload = {
            **draft.model_dump(exclude={"user_id"}),
            "review_flags": [flag.model_dump() for flag in review_flags],
        }
        return ResumeDraftResponse.model_validate(payload)
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/judge", response_model=ApplicationDetail, status_code=status.HTTP_202_ACCEPTED)
async def trigger_resume_judge_for_application(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.trigger_resume_judge(
                user_id=current_user.id,
                application_id=application_id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{application_id}/generate", response_model=ApplicationDetail, status_code=status.HTTP_202_ACCEPTED)
async def generate_resume(
    application_id: str,
    request: GenerateResumeRequest,
    raw_request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    logger.info(
        "generation_route %s",
        {
            "event": "generation_route_entry",
            "request_id": raw_request.headers.get("x-request-id"),
            "user_id": current_user.id,
            "application_id": application_id,
            "workflow_kind": "generation",
            "base_resume_id": request.base_resume_id,
            "target_length": request.target_length,
            "aggressiveness": request.aggressiveness,
            "has_additional_instructions": bool(request.additional_instructions),
            "additional_instructions_length": len(request.additional_instructions or ""),
        },
    )
    try:
        return to_application_detail(
            await service.trigger_generation(
                user_id=current_user.id,
                application_id=application_id,
                base_resume_id=request.base_resume_id,
                target_length=request.target_length,
                aggressiveness=request.aggressiveness,
                additional_instructions=request.additional_instructions,
            )
        )
    except Exception as error:
        logger.warning(
            "generation_route %s",
            {
                "event": "generation_route_error",
                "request_id": raw_request.headers.get("x-request-id"),
                "user_id": current_user.id,
                "application_id": application_id,
                "workflow_kind": "generation",
                "error_type": type(error).__name__,
                "message": str(error),
            },
        )
        raise _map_service_error(error) from error


@router.post("/{application_id}/regenerate", response_model=ApplicationDetail, status_code=status.HTTP_202_ACCEPTED)
async def regenerate_full(
    application_id: str,
    request: FullRegenerationRequest,
    raw_request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    logger.info(
        "generation_route %s",
        {
            "event": "generation_route_entry",
            "request_id": raw_request.headers.get("x-request-id"),
            "user_id": current_user.id,
            "application_id": application_id,
            "workflow_kind": "regeneration_full",
            "target_length": request.target_length,
            "aggressiveness": request.aggressiveness,
            "has_additional_instructions": bool(request.additional_instructions),
            "additional_instructions_length": len(request.additional_instructions or ""),
        },
    )
    try:
        return to_application_detail(
            await service.trigger_full_regeneration(
                user_id=current_user.id,
                application_id=application_id,
                target_length=request.target_length,
                aggressiveness=request.aggressiveness,
                additional_instructions=request.additional_instructions,
            )
        )
    except Exception as error:
        logger.warning(
            "generation_route %s",
            {
                "event": "generation_route_error",
                "request_id": raw_request.headers.get("x-request-id"),
                "user_id": current_user.id,
                "application_id": application_id,
                "workflow_kind": "regeneration_full",
                "error_type": type(error).__name__,
                "message": str(error),
            },
        )
        raise _map_service_error(error) from error


@router.post("/{application_id}/regenerate-section", response_model=ApplicationDetail, status_code=status.HTTP_202_ACCEPTED)
async def regenerate_section(
    application_id: str,
    request: SectionRegenerationRequest,
    raw_request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    logger.info(
        "generation_route %s",
        {
            "event": "generation_route_entry",
            "request_id": raw_request.headers.get("x-request-id"),
            "user_id": current_user.id,
            "application_id": application_id,
            "workflow_kind": "regeneration_section",
            "section_name": request.section_name,
            "instructions_length": len(request.instructions or ""),
        },
    )
    try:
        return to_application_detail(
            await service.trigger_section_regeneration(
                user_id=current_user.id,
                application_id=application_id,
                section_name=request.section_name,
                instructions=request.instructions,
            )
        )
    except Exception as error:
        logger.warning(
            "generation_route %s",
            {
                "event": "generation_route_error",
                "request_id": raw_request.headers.get("x-request-id"),
                "user_id": current_user.id,
                "application_id": application_id,
                "workflow_kind": "regeneration_section",
                "section_name": request.section_name,
                "error_type": type(error).__name__,
                "message": str(error),
            },
        )
        raise _map_service_error(error) from error


@router.post("/{application_id}/cancel-generation", response_model=ApplicationDetail)
async def cancel_generation(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ApplicationDetail:
    try:
        return to_application_detail(
            await service.cancel_generation(
                user_id=current_user.id,
                application_id=application_id,
            )
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.put("/{application_id}/draft", response_model=ResumeDraftResponse)
async def save_draft(
    application_id: str,
    request: SaveDraftRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> ResumeDraftResponse:
    try:
        draft = await service.save_draft_edit(
            user_id=current_user.id,
            application_id=application_id,
            content=request.content,
        )
        return ResumeDraftResponse.model_validate(draft.model_dump(exclude={"user_id"}))
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{application_id}/export-pdf")
async def export_pdf(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> Response:
    try:
        pdf_bytes, filename = await service.export_pdf(
            user_id=current_user.id,
            application_id=application_id,
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{application_id}/export-docx")
async def export_docx(
    application_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[ApplicationService, Depends(get_application_service)],
) -> Response:
    try:
        docx_bytes, filename = await service.export_docx(
            user_id=current_user.id,
            application_id=application_id,
        )
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except Exception as error:
        raise _map_service_error(error) from error
