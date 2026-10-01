from __future__ import annotations

import logging
import asyncio
import time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, status, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.access import get_current_active_user
from app.core.auth import AuthenticatedUser
from app.services.base_resumes import BaseResumeService, get_base_resume_service
from app.services.resume_document import ResumeDocument
from app.services.resume_parser import (
    PdfParseFailedError,
    PdfParseRejectedError,
    PdfParseTimeoutError,
    ResumeParserService,
    parse_pdf_with_timeout,
)

router = APIRouter(prefix="/api/base-resumes", tags=["base-resumes"])
logger = logging.getLogger(__name__)

MAX_PDF_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_RESUME_NAME_LENGTH = 200
MAX_RESUME_MARKDOWN_LENGTH = 200_000


def get_resume_parser() -> ResumeParserService:
    from app.core.config import get_settings

    settings = get_settings()
    return ResumeParserService(
        openrouter_api_key=settings.openrouter_api_key,
        openrouter_model=settings.tier2_model,
        openrouter_fallback_model=settings.tier2_fallback_model,
        openrouter_base_url=settings.openrouter_base_url,
        classifier=settings.resume_import_classifier,
        classification_model=settings.openrouter_classification_model,
        confidence_threshold=settings.resume_import_confidence_threshold,
        langsmith_tracing=settings.langsmith_tracing,
        langsmith_project=settings.langsmith_project,
        langsmith_api_key=settings.langsmith_api_key,
    )


class CreateBaseResumeRequest(BaseModel):
    name: str
    content_md: str = ""
    document: Optional[ResumeDocument] = None

    @model_validator(mode="after")
    def require_content(self):
        if self.document is None and not self.content_md.strip():
            raise ValueError("Resume content or a resume document is required.")
        return self

    @field_validator("name")
    @classmethod
    def require_non_blank_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Resume name cannot be blank.")
        if len(stripped) > MAX_RESUME_NAME_LENGTH:
            raise ValueError("Resume name is too long.")
        return stripped

    @field_validator("content_md")
    @classmethod
    def validate_content_size(cls, value: str) -> str:
        if len(value) > MAX_RESUME_MARKDOWN_LENGTH:
            raise ValueError("Resume content is too large.")
        return value


class UpdateBaseResumeRequest(BaseModel):
    name: Optional[str] = None
    content_md: Optional[str] = None
    document: Optional[ResumeDocument] = None
    expected_revision: Optional[int] = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def validate_name_if_provided(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Resume name cannot be blank.")
        if len(stripped) > MAX_RESUME_NAME_LENGTH:
            raise ValueError("Resume name is too long.")
        return stripped

    @field_validator("content_md")
    @classmethod
    def validate_content_size(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and len(value) > MAX_RESUME_MARKDOWN_LENGTH:
            raise ValueError("Resume content is too large.")
        return value


class BaseResumeSummary(BaseModel):
    id: str
    name: str
    is_default: bool
    created_at: str
    updated_at: str


class BaseResumeDetail(BaseModel):
    id: str
    name: str
    content_md: str
    document: ResumeDocument
    revision: int
    raw_source_md: Optional[str] = None
    ready_for_generation: bool = False
    contact_suggestions: dict[str, str] = Field(default_factory=dict)
    is_default: bool
    created_at: str
    updated_at: str
    needs_review: bool = False
    import_warning: Optional[str] = None


def _map_service_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, PermissionError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Base resume request failed.",
    )


@router.get("", response_model=list[BaseResumeSummary])
async def list_base_resumes(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
) -> list[BaseResumeSummary]:
    records = service.list_resumes(user_id=current_user.id)
    return [BaseResumeSummary.model_validate(record.model_dump()) for record in records]


@router.post("", response_model=BaseResumeDetail, status_code=status.HTTP_201_CREATED)
async def create_base_resume(
    request: CreateBaseResumeRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
) -> BaseResumeDetail:
    try:
        record = service.create_resume(
            user_id=current_user.id,
            name=request.name,
            content_md=request.content_md,
            document=request.document.model_dump(mode="json") if request.document is not None else None,
        )
        return BaseResumeDetail.model_validate(record.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/upload", response_model=BaseResumeDetail, status_code=status.HTTP_201_CREATED)
async def upload_base_resume(
    file: Annotated[UploadFile, File(...)],
    name: Annotated[str, Form(...)],
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
    parser: Annotated[ResumeParserService, Depends(get_resume_parser)],
    use_llm_cleanup: Annotated[bool, Form()] = True,
) -> BaseResumeDetail:
    clean_name = name.strip()
    started_at = time.monotonic()
    if not clean_name or len(clean_name) > MAX_RESUME_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resume name is required and must be at most 200 characters.",
        )
    # Validate file extension
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported.",
        )

    # Validate content type (allow empty content_type as some clients don't set it)
    content_type = file.content_type or ""
    if content_type and content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid content type: {content_type}. Only PDF files are supported.",
        )

    # Read file content
    file_bytes = await file.read(MAX_PDF_SIZE + 1)
    await file.close()

    # Validate file size
    if len(file_bytes) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size exceeds maximum allowed size of {MAX_PDF_SIZE // (1024 * 1024)} MB.",
        )
    if not file_bytes.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid PDF.",
        )

    # Parse the PDF
    try:
        raw_markdown = await run_in_threadpool(parse_pdf_with_timeout, file_bytes)
    except PdfParseTimeoutError as error:
        logger.warning("PDF upload parsing timed out (size_bytes=%d).", len(file_bytes))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "pdf_parse_timeout", "message": "PDF parsing timed out."},
        ) from error
    except PdfParseRejectedError as error:
        code = "pdf_limit_exceeded"
        logger.info("PDF upload rejected by parser limits (size_bytes=%d).", len(file_bytes))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": code, "message": str(error)},
        ) from error
    except PdfParseFailedError as error:
        logger.warning("PDF upload parsing failed (size_bytes=%d).", len(file_bytes))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_pdf", "message": "Failed to parse PDF file."},
        ) from error

    # PDF parsing and AI assistance share one import deadline. The raw extraction
    # remains recoverable even when assistance is unavailable or ambiguous.
    try:
        import_result = await asyncio.wait_for(
            parser.import_resume(raw_markdown, use_llm_cleanup=use_llm_cleanup),
            timeout=max(0.01, 30.0 - (time.monotonic() - started_at)),
        )
    except asyncio.TimeoutError:
        import_result = parser.local_import(
            raw_markdown,
            warning="Import assistance timed out. Your original text was preserved; review the sections before generating.",
        )

    # Create the base resume
    try:
        record = service.create_resume(
            user_id=current_user.id,
            name=clean_name,
            content_md=raw_markdown,
            document=import_result.document,
            raw_source_md=raw_markdown,
            import_warning=import_result.warning,
            contact_suggestions=import_result.contact_suggestions,
        )
        return BaseResumeDetail.model_validate(
            {
                **record.model_dump(),
                "needs_review": True,
                "import_warning": import_result.warning,
            }
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.get("/{resume_id}", response_model=BaseResumeDetail)
async def get_base_resume(
    resume_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
) -> BaseResumeDetail:
    try:
        record = service.get_resume(
            user_id=current_user.id,
            resume_id=resume_id,
        )
        return BaseResumeDetail.model_validate(record.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error


@router.patch("/{resume_id}", response_model=BaseResumeDetail)
async def update_base_resume(
    resume_id: str,
    request: UpdateBaseResumeRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
) -> BaseResumeDetail:
    updates = request.model_dump(exclude_unset=True)
    if not set(updates).difference({"expected_revision"}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No resume updates provided.",
        )
    try:
        record = service.update_resume(
            user_id=current_user.id,
            resume_id=resume_id,
            updates=updates,
        )
        return BaseResumeDetail.model_validate(record.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_base_resume(
    resume_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
    force: bool = Query(default=False),
) -> None:
    try:
        service.delete_resume(
            user_id=current_user.id,
            resume_id=resume_id,
            force=force,
        )
    except Exception as error:
        raise _map_service_error(error) from error


@router.post("/{resume_id}/set-default", response_model=BaseResumeSummary)
async def set_default_resume(
    resume_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_active_user)],
    service: Annotated[BaseResumeService, Depends(get_base_resume_service)],
) -> BaseResumeSummary:
    try:
        record = service.set_default(
            user_id=current_user.id,
            resume_id=resume_id,
        )
        return BaseResumeSummary.model_validate(record.model_dump())
    except Exception as error:
        raise _map_service_error(error) from error
