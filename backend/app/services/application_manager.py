from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from functools import lru_cache
from time import perf_counter
from typing import Any, Literal, Optional

from fastapi import Depends
from pydantic import BaseModel, Field, field_validator

from app.core.config import Settings, get_settings
from app.db.applications import (
    ApplicationListRecord,
    ApplicationRecord,
    ApplicationRepository,
    MatchedApplicationRecord,
    get_application_repository,
)
from app.db.base_resumes import BaseResumeRepository, get_base_resume_repository
from app.db.notifications import NotificationRepository, get_notification_repository
from app.db.profiles import ProfileRepository, get_profile_repository
from app.db.resume_drafts import ResumeDraftRecord, ResumeDraftRepository, get_resume_draft_repository
from app.db.subscriptions import (
    QuotaReservationRecord,
    SubscriptionRepository,
    get_subscription_repository,
)
from app.db.usage_events import UsageEventRecord, UsageEventRepository, get_usage_event_repository
from app.services.duplicates import DuplicateDetector
from app.services.email import EmailMessage, EmailSender, build_email_sender
from app.services.jobs import (
    ExtractionJobQueue,
    GenerationJobQueue,
    KeywordExtractionJobQueue,
    get_extraction_job_queue,
    get_generation_job_queue,
    get_keyword_extraction_job_queue,
)
from app.services.pdf_export import generate_docx, generate_pdf
from app.services.progress import (
    ApplicationEvent,
    ProgressRecord,
    RedisProgressStore,
    build_progress,
    get_progress_store,
)
from app.services.resume_render import normalize_resume_markdown
from app.services.resume_length import assess_resume_length
from app.services.resume_privacy import sanitize_resume_markdown
from app.services.url_security import validate_public_http_url
from app.services.workflow import derive_visible_status

logger = logging.getLogger(__name__)

FULL_GENERATION_IDLE_TIMEOUT_SECONDS = 240
FULL_GENERATION_MAX_TIMEOUT_SECONDS = 240
SECTION_REGENERATION_IDLE_TIMEOUT_SECONDS = 120
SECTION_REGENERATION_MAX_TIMEOUT_SECONDS = 120
RESUME_JUDGE_RUN_LIMIT_PER_DRAFT = 3
DEFAULT_SECTION_ORDER = ["summary", "professional_experience", "education", "skills", "projects", "certifications"]
ACTIVE_GENERATION_STATES = {"generating", "regenerating_full", "regenerating_section"}
ACTIVE_GENERATION_PROGRESS_STATES = {
    "generation_pending",
    "generating",
    "regenerating_full",
    "regenerating_section",
}
ACTIVITY_EVENT_TYPE = "application_activity"
ACTIVE_EXTRACTION_STATES = {"extraction_pending", "extracting"}
ACTIVE_DELETE_BLOCKING_STATES = {
    "extraction_pending",
    "extracting",
    "generating",
    "regenerating_full",
    "regenerating_section",
}
EXTRACTION_CALLBACK_SYNC_FAILURE_MESSAGE = (
    "Extraction finished, but results could not be synchronized. Retry extraction or complete manual entry."
)
GENERATION_CALLBACK_SYNC_FAILURE_MESSAGE = (
    "Generation finished, but the new draft could not be synchronized. Please retry generation."
)
REGENERATION_CALLBACK_SYNC_FAILURE_MESSAGE = (
    "Regeneration finished, but the updated draft could not be synchronized. Please retry regeneration."
)
KEYWORD_EXTRACTION_STALE_TIMEOUT_SECONDS = 180
KEYWORD_MANUAL_MAX_COUNT = 30
KEYWORD_TEXT_MAX_CHARS = 80
BLOCKED_PLACEHOLDER_TITLE_PREFIXES = ("blocked - ",)
BLOCKED_PLACEHOLDER_TITLE_VALUES = {"you have been blocked", "access denied", "attention required"}
BLOCKED_PLACEHOLDER_DESCRIPTION_MARKERS = (
    "you have been blocked",
    "ray id for this request",
    "request blocked notice",
    "support.indeed.com",
    "access denied",
    "attention required",
)
JOB_KEYWORD_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#/-]{2,}")
EXPERIENCE_HEADER_DATE_RE = re.compile(
    r"\b(?:\d{4}\s*[-/]\s*(?:\d{4}|present)|present|current)\b",
    re.I,
)
JD_STOPWORDS = {
    "about",
    "across",
    "also",
    "and",
    "are",
    "build",
    "building",
    "candidate",
    "company",
    "experience",
    "for",
    "from",
    "have",
    "help",
    "including",
    "into",
    "join",
    "looking",
    "must",
    "our",
    "role",
    "team",
    "that",
    "the",
    "their",
    "this",
    "will",
    "with",
    "you",
    "your",
}
KEYWORD_COVERAGE_TARGETS = {"low": 45, "medium": 65, "high": 80}
KEYWORD_STATUS_EMPTY = "unavailable"
KEYWORD_OPTIMIZATION_TARGET = "keyword_optimization"


class DuplicateWarningPayload(BaseModel):
    similarity_score: float
    matched_fields: list[str]
    match_basis: str
    matched_application: MatchedApplicationRecord


class ApplicationDetailPayload(BaseModel):
    application: ApplicationRecord
    duplicate_warning: Optional[DuplicateWarningPayload]
    resume_judge_result: Optional[dict[str, Any]] = None


class ExtractionFailureDetailsPayload(BaseModel):
    kind: str
    provider: Optional[str] = None
    reference_id: Optional[str] = None
    blocked_url: Optional[str] = None
    detected_at: str


class WorkerSuccessPayload(BaseModel):
    job_title: str
    job_description: str
    company: Optional[str] = None
    job_location_text: Optional[str] = None
    compensation_text: Optional[str] = None
    job_posting_origin: Optional[str] = None
    job_posting_origin_other_text: Optional[str] = None
    extracted_reference_id: Optional[str] = None
    model_used: Optional[str] = None
    job_keywords: Optional[dict[str, Any]] = None


class WorkerFailurePayload(BaseModel):
    message: str
    terminal_error_code: str = "extraction_failed"
    failure_details: Optional[ExtractionFailureDetailsPayload] = None


class SourceCapturePayload(BaseModel):
    source_text: str
    source_url: Optional[str] = None
    page_title: Optional[str] = None
    meta: dict[str, str] = Field(default_factory=dict)
    json_ld: list[str] = Field(default_factory=list)
    captured_at: Optional[str] = None

    @field_validator("source_text")
    @classmethod
    def require_source_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Source text cannot be blank.")
        return stripped

    @field_validator("source_url", "page_title", "captured_at")
    @classmethod
    def normalize_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class WorkerCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    extracted: Optional[WorkerSuccessPayload] = None
    failure: Optional[WorkerFailurePayload] = None


class GenerationSuccessPayload(BaseModel):
    content_md: str
    generation_params: dict[str, Any]
    sections_snapshot: dict[str, Any]
    attempts: Optional[list[dict[str, Any]]] = None
    length_diagnostics: Optional[dict[str, Any]] = None


class GenerationFailurePayload(BaseModel):
    message: str
    terminal_error_code: str = "generation_failed"
    failure_details: Optional[dict[str, Any]] = None


class ResumeJudgeDimensionPayload(BaseModel):
    score: int
    weight: float
    weighted_contribution: float
    notes: str


class ResumeJudgeErrorPayload(BaseModel):
    error_type: Optional[str] = None
    message: Optional[str] = None


class ResumeJudgeResultPayload(BaseModel):
    status: str
    message: Optional[str] = None
    final_score: Optional[float] = None
    display_score: Optional[int] = None
    verdict: Optional[str] = None
    pass_threshold: Optional[float] = None
    score_summary: Optional[str] = None
    dimension_scores: Optional[dict[str, ResumeJudgeDimensionPayload]] = None
    regeneration_instructions: Optional[dict[str, list[str]] | str] = None
    regeneration_priority_dimensions: list[str] = Field(default_factory=list)
    evaluator_notes: Optional[str] = None
    evaluated_draft_updated_at: Optional[str] = None
    scored_at: Optional[str] = None
    job_context_signature: Optional[str] = None
    input_signature: Optional[str] = None
    is_stale: Optional[bool] = None
    failure_stage: Optional[str] = None
    run_attempt_count: Optional[int] = None
    attempt_count: Optional[int] = None
    attempts: Optional[list[dict[str, Any]]] = None
    error: Optional[ResumeJudgeErrorPayload] = None


class ResumeJudgeFailurePayload(BaseModel):
    message: Optional[str] = None
    result: ResumeJudgeResultPayload


class ResumeJudgeCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    evaluated_draft_updated_at: str
    job_context_signature: Optional[str] = None
    input_signature: Optional[str] = None
    result: Optional[ResumeJudgeResultPayload] = None
    failure: Optional[ResumeJudgeFailurePayload] = None


class KeywordExtractionFailurePayload(BaseModel):
    message: str


class KeywordExtractionCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: Literal["started", "failed", "succeeded"]
    source_hash: str
    keywords: Optional[list[str]] = None
    model_used: Optional[str] = None
    failure: Optional[KeywordExtractionFailurePayload] = None


class GenerationCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    quota_period_start: Optional[str] = None
    generated: Optional[GenerationSuccessPayload] = None
    failure: Optional[GenerationFailurePayload] = None


class RegenerationCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    regeneration_target: str = "full"
    quota_period_start: Optional[str] = None
    generated: Optional[GenerationSuccessPayload] = None
    failure: Optional[GenerationFailurePayload] = None


class DraftReviewFlagPayload(BaseModel):
    section_name: str
    text: str
    reason: str = "job_description_only_addition"
    metadata: Optional[dict[str, Any]] = None


class ApplicationActivityPayload(BaseModel):
    id: str
    type: str
    status: str
    title: str
    summary: str
    created_at: str
    details: Optional[dict[str, Any]] = None
    failure_message: Optional[str] = None
    attempts: Optional[list[dict[str, Any]]] = None


GENERATION_DUPLICATE_BLOCKER_MESSAGE = (
    "This looks like a duplicate application. Review the duplicate warning and choose "
    "Proceed Anyway before generating."
)

ACTIVITY_CONTENT_MAP: dict[str, tuple[str, str]] = {
    "application_created": ("Application created", "Application added and extraction queued."),
    "extraction_started": ("Extraction started", "Job extraction started."),
    "extraction_retried": ("Extraction retried", "Extraction was retried for this posting."),
    "extraction_recovered": ("Recovery extraction queued", "Extraction was queued from pasted job content."),
    "manual_entry_submitted": ("Manual entry submitted", "Manual job details were saved."),
    "job_info_updated": ("Job details updated", "Job details were edited."),
    "generation_started": ("Resume generation started", "Resume generation started."),
    "generation_succeeded": ("Resume generated", "Resume generation completed."),
    "generation_failed": ("Generation failed", "Resume generation failed."),
    "generation_cancelled": ("Generation cancelled", "Generation was cancelled."),
    "regeneration_full_started": ("Full regeneration started", "Full resume regeneration started."),
    "regeneration_full_succeeded": ("Full regeneration completed", "Full resume regeneration completed."),
    "regeneration_section_started": ("Section regeneration started", "Section regeneration started."),
    "regeneration_section_succeeded": ("Section regenerated", "Section regeneration completed."),
    "regeneration_failed": ("Regeneration failed", "Resume regeneration failed."),
    "resume_judge_queued": ("Resume Judge queued", "Resume Judge was queued."),
    "resume_judge_succeeded": ("Resume Judge completed", "Resume Judge completed."),
    "resume_judge_failed": ("Resume Judge failed", "Resume Judge failed."),
    "keywords_updated": ("ATS keywords updated", "Manual ATS keywords were updated."),
    "keyword_optimization_started": ("Keyword optimization started", "Resume keyword optimization started."),
    "keyword_optimization_succeeded": ("Keyword optimization completed", "Resume keyword optimization completed."),
    "draft_saved": ("Draft saved", "Draft edits were saved."),
    "export_succeeded": ("Export completed", "Resume export completed."),
    "export_failed": ("Export failed", "Resume export failed."),
    "applied_toggled": ("Applied status changed", "Applied status was updated."),
    "duplicate_resolution": ("Duplicate review resolved", "Duplicate warning resolution was saved."),
    "notes_updated": ("Notes updated", "Application notes were updated."),
    "extraction_cancelled": ("Extraction stopped", "Extraction was stopped."),
    "extraction_succeeded": ("Extraction completed", "Job details were extracted."),
    "extraction_failed": ("Extraction failed", "Extraction failed and manual recovery is required."),
}


class ApplicationService:
    def __init__(
        self,
        *,
        repository: ApplicationRepository,
        base_resume_repository: BaseResumeRepository,
        draft_repository: ResumeDraftRepository,
        profile_repository: ProfileRepository,
        notification_repository: NotificationRepository,
        progress_store: RedisProgressStore,
        extraction_job_queue: ExtractionJobQueue,
        generation_job_queue: GenerationJobQueue,
        email_sender: EmailSender,
        settings: Settings,
        # Optional for tests and legacy construction paths; the DI factory always supplies it.
        keyword_extraction_job_queue: Optional[KeywordExtractionJobQueue] = None,
        usage_event_repository: Optional[UsageEventRepository] = None,
        subscription_repository: Optional[SubscriptionRepository] = None,
    ) -> None:
        self.repository = repository
        self.base_resume_repository = base_resume_repository
        self.draft_repository = draft_repository
        self.profile_repository = profile_repository
        self.notification_repository = notification_repository
        self.progress_store = progress_store
        self.extraction_job_queue = extraction_job_queue
        self.generation_job_queue = generation_job_queue
        self.keyword_extraction_job_queue = keyword_extraction_job_queue
        self.email_sender = email_sender
        self.settings = settings
        self.usage_event_repository = usage_event_repository
        self.subscription_repository = subscription_repository
        self.duplicate_detector = DuplicateDetector(settings.duplicate_similarity_threshold)

    async def list_applications(
        self,
        *,
        user_id: str,
        search: Optional[str],
        visible_status: Optional[str],
    ) -> list[ApplicationListRecord]:
        return self.repository.list_applications(
            user_id,
            search=search,
            visible_status=visible_status,
        )

    async def create_application(self, *, user_id: str, job_url: str) -> ApplicationRecord:
        await validate_public_http_url(job_url)
        record = self.repository.create_application(
            user_id=user_id,
            job_url=job_url,
            visible_status="draft",
            internal_state="extraction_pending",
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=record.id,
            activity_type="application_created",
            summary="Application created and extraction queued.",
        )

        try:
            job_id = await self.extraction_job_queue.enqueue(
                application_id=record.id,
                user_id=user_id,
                job_url=job_url,
            )
            await self.progress_store.set(
                record.id,
                build_progress(
                    job_id=job_id,
                    state="extraction_pending",
                    message="Application created. Extraction is queued.",
                    percent_complete=0,
                ),
            )
            return self._refresh(user_id=user_id, application_id=record.id)
        except Exception:
            fallback_job_id = f"failed-{record.id}"
            failed_progress = build_progress(
                job_id=fallback_job_id,
                state="manual_entry_required",
                message="Extraction could not be started. Enter the job details manually.",
                percent_complete=100,
                terminal_error_code="extraction_failed",
            )
            failed_progress.completed_at = failed_progress.updated_at
            await self.progress_store.set(
                record.id,
                failed_progress,
            )
            return await self._mark_extraction_failure(
                record=record,
                message="Extraction could not be started. Enter the job details manually.",
            )

    async def create_application_from_capture(
        self,
        *,
        user_id: str,
        job_url: Optional[str],
        capture: SourceCapturePayload,
    ) -> ApplicationRecord:
        record = self.repository.create_application(
            user_id=user_id,
            job_url=job_url,
            visible_status="draft",
            internal_state="extraction_pending",
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=record.id,
            activity_type="application_created",
            summary="Application created from capture and extraction queued.",
            details={"source": "capture"},
        )

        return await self._enqueue_source_capture(
            record=record,
            job_url=job_url,
            capture=capture,
            queued_message="Application created from browser capture. Extraction is queued.",
            failure_message="Captured page extraction could not be started. Paste the job text or enter it manually.",
        )

    async def get_application_detail(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)
        record = await self._recover_stuck_generation_if_needed(record)
        progress = await self.progress_store.get(record.id)
        record = await self._reconcile_terminal_extraction_progress(record, progress)
        record = await self._reconcile_terminal_generation_progress(record, progress)
        record = await self._recover_stale_keyword_extraction_if_needed(record)

        return self._detail_payload(record)

    async def list_application_activity(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> list[ApplicationActivityPayload]:
        record = self._require_application(user_id=user_id, application_id=application_id)
        events: list[UsageEventRecord] = []
        if self.usage_event_repository is not None:
            events = self.usage_event_repository.list_application_events(
                user_id=user_id,
                application_id=application_id,
            )

        payload = [self._to_activity_payload(event) for event in events]
        for item in payload:
            if item.type == "extraction_succeeded":
                if item.details is None:
                    item.details = {}
                for key in ("job_title", "company", "job_location_text", "job_posting_origin", "job_posting_origin_other_text", "compensation_text"):
                    val = getattr(record, key, None)
                    if val is not None and item.details.get(key) is None:
                        item.details[key] = val
            elif item.type == "resume_judge_succeeded":
                if item.details is None:
                    item.details = {}
                if isinstance(record.resume_judge_result, dict):
                    for key in ("display_score", "verdict", "score_summary", "evaluator_notes"):
                        val = record.resume_judge_result.get(key)
                        if val is not None and item.details.get(key) is None:
                            item.details[key] = val

        if not any(item.type == "application_created" for item in payload):
            payload.append(
                ApplicationActivityPayload(
                    id=f"synthetic-{application_id}-created",
                    type="application_created",
                    status="info",
                    title="Application created",
                    summary="Application added.",
                    created_at=record.created_at,
                )
            )
        return sorted(payload, key=lambda item: self._timestamp_for_sort(item.created_at), reverse=True)

    async def patch_application(
        self,
        *,
        user_id: str,
        application_id: str,
        updates: dict[str, Any],
    ) -> ApplicationDetailPayload:
        current = self._require_application(user_id=user_id, application_id=application_id)
        job_description_changed = (
            "job_description" in updates
            and (updates.get("job_description") or "") != (current.job_description or "")
        )
        duplicate_relevant_fields = {
            "job_title",
            "company",
            "job_description",
            "job_posting_origin",
            "job_posting_origin_other_text",
        }
        job_context_fields = {"job_title", "company", "job_description"}
        merged_updates = dict(updates)
        if (
            current.resume_judge_result is not None
            and job_context_fields.intersection(updates.keys())
            and self._resume_judge_job_context_changed(record=current, updates=updates)
        ):
            draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
            if draft is not None:
                updated_job_title = updates.get("job_title", current.job_title)
                updated_company = updates.get("company", current.company)
                updated_job_description = updates.get("job_description", current.job_description)
                merged_updates["resume_judge_result"] = self._resume_judge_status_payload(
                    status="failed",
                    message="Resume Judge needs another run because the job details changed.",
                    evaluated_draft_updated_at=draft.updated_at,
                    scored_at=datetime.now(timezone.utc).isoformat(),
                    job_context_signature=self._resume_judge_job_context_signature(
                        job_title=updated_job_title,
                        company_name=updated_company,
                        job_description=updated_job_description,
                    ),
                    input_signature=self._resume_judge_input_signature(
                        record=current,
                        draft=draft,
                        job_title=updated_job_title,
                        company_name=updated_company,
                        job_description=updated_job_description,
                    ),
                    failure_stage="stale_job_context",
                )
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=merged_updates,
        )

        if (
            duplicate_relevant_fields.intersection(updates.keys())
            and current.internal_state != "manual_entry_required"
        ):
            updated = await self._run_duplicate_resolution_flow(updated)
        elif "applied" in updates or "notes" in updates:
            updated = self._refresh(user_id=user_id, application_id=application_id)

        if "applied" in updates and updates.get("applied") != current.applied:
            applied_value = bool(updates.get("applied"))
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="applied_toggled",
                summary=f"Marked as {'applied' if applied_value else 'not applied'}.",
                details={"applied": applied_value},
            )
        if "notes" in updates and updates.get("notes") != current.notes:
            notes_value = str(updates.get("notes") or "")
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="notes_updated",
                details={"has_notes": bool(notes_value.strip())},
            )
        if duplicate_relevant_fields.intersection(updates.keys()):
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="job_info_updated",
                details={"fields": sorted(list(duplicate_relevant_fields.intersection(updates.keys())))},
            )
        if job_description_changed:
            updated = await self._enqueue_keyword_extraction_for_record(updated, force=True)

        return self._detail_payload(updated)

    async def delete_application(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> None:
        record = self._require_application(user_id=user_id, application_id=application_id)
        progress: Optional[ProgressRecord] = None
        try:
            progress = await self.progress_store.get(application_id)
        except Exception:
            logger.warning(
                "Failed loading progress for delete on application %s; proceeding without reconciliation.",
                application_id,
                exc_info=True,
            )

        if progress is not None:
            try:
                record = await self._reconcile_terminal_extraction_progress(record, progress)
                record = await self._reconcile_terminal_generation_progress(record, progress)
            except Exception:
                logger.warning(
                    "Failed reconciling terminal progress for delete on application %s; proceeding with current state.",
                    application_id,
                    exc_info=True,
                )
        if record.internal_state in ACTIVE_DELETE_BLOCKING_STATES:
            raise PermissionError("Application cannot be deleted while background work is still running.")

        try:
            await self.progress_store.delete(application_id)
        except Exception:
            logger.warning(
                "Failed deleting cached progress for application %s; continuing with database delete.",
                application_id,
                exc_info=True,
            )
        self.repository.delete_application(application_id=application_id, user_id=user_id)

    async def complete_manual_entry(
        self,
        *,
        user_id: str,
        application_id: str,
        updates: dict[str, Any],
    ) -> ApplicationDetailPayload:
        self._require_application(user_id=user_id, application_id=application_id)
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates={
                **updates,
                "extraction_failure_details": None,
            },
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="manual_entry_submitted",
        )
        updated = await self._run_duplicate_resolution_flow(updated)
        updated = await self._enqueue_keyword_extraction_for_record(updated, force=True)
        return self._detail_payload(updated)

    async def recover_from_source(
        self,
        *,
        user_id: str,
        application_id: str,
        capture: SourceCapturePayload,
    ) -> ApplicationDetailPayload:
        current = self._require_application(user_id=user_id, application_id=application_id)
        next_job_url = capture.source_url or current.job_url
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates={
                "job_url": next_job_url,
                **self._workflow_updates(
                    internal_state="extraction_pending",
                    failure_reason=None,
                    extraction_failure_details=None,
                    duplicate_similarity_score=None,
                    duplicate_match_fields=None,
                    duplicate_resolution_status=None,
                    duplicate_matched_application_id=None,
                ),
            },
        )
        self.notification_repository.clear_action_required(user_id=user_id, application_id=application_id)

        try:
            job_id = await self.extraction_job_queue.enqueue(
                application_id=application_id,
                user_id=user_id,
                job_url=next_job_url,
                source_capture=capture.model_dump(),
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    state="extraction_pending",
                    message="Recovery extraction queued from pasted page text.",
                    percent_complete=0,
                ),
            )
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="extraction_recovered",
            )
            return self._detail_payload(updated)
        except Exception:
            failed = await self._mark_extraction_failure(
                record=updated,
                message="Recovery extraction could not be started. Paste more of the job text or enter it manually.",
            )
            return self._detail_payload(failed)

    async def retry_extraction(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        current = self._require_application(user_id=user_id, application_id=application_id)
        if not current.job_url:
            raise PermissionError("Add a source URL or retry with pasted job text before rerunning extraction.")
        await validate_public_http_url(current.job_url)
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=self._workflow_updates(
                internal_state="extraction_pending",
                failure_reason=None,
                extraction_failure_details=None,
                duplicate_similarity_score=None,
                duplicate_match_fields=None,
                duplicate_resolution_status=None,
                duplicate_matched_application_id=None,
            ),
        )
        self.notification_repository.clear_action_required(user_id=user_id, application_id=application_id)
        try:
            job_id = await self.extraction_job_queue.enqueue(
                application_id=application_id,
                user_id=user_id,
                job_url=current.job_url,
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    state="extraction_pending",
                    message="Extraction retry queued.",
                    percent_complete=0,
                ),
            )
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="extraction_retried",
            )
            return self._detail_payload(updated)
        except Exception:
            fallback_job_id = f"failed-{application_id}"
            failed_progress = build_progress(
                job_id=fallback_job_id,
                state="manual_entry_required",
                message="Extraction retry could not be started. Paste the job text or enter the details manually.",
                percent_complete=100,
                terminal_error_code="extraction_failed",
            )
            failed_progress.completed_at = failed_progress.updated_at
            await self.progress_store.set(application_id, failed_progress)
            failed = await self._mark_extraction_failure(
                record=updated,
                message="Extraction retry could not be started. Paste the job text or enter the details manually.",
            )
            return self._detail_payload(failed)

    async def resolve_duplicate(
        self,
        *,
        user_id: str,
        application_id: str,
        resolution: str,
    ) -> ApplicationDetailPayload:
        current = self._require_application(user_id=user_id, application_id=application_id)
        if (
            current.internal_state != "duplicate_review_required"
            or current.duplicate_resolution_status != "pending"
            or not current.duplicate_matched_application_id
        ):
            raise PermissionError("Duplicate resolution is unavailable for this application.")

        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=self._workflow_updates(
                internal_state="generation_pending",
                failure_reason=None,
                duplicate_resolution_status=resolution,
            ),
        )
        self.notification_repository.clear_action_required(user_id=user_id, application_id=application_id)
        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="duplicate_resolution",
            summary=f"Duplicate warning marked as {resolution}.",
            details={"resolution": resolution},
        )
        return self._detail_payload(updated)

    async def cancel_generation(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)
        current_progress = await self.progress_store.get(application_id)

        if not self._is_generation_active(record=record, progress=current_progress):
            raise PermissionError("No active generation to cancel.")

        target_state = self._target_state_after_generation_stop(record, current_progress)

        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=self._workflow_updates(
                internal_state=target_state,
                failure_reason="generation_cancelled",
                generation_failure_details={"message": "Generation was cancelled by user."},
            ),
        )
        await self._set_terminal_generation_progress(
            record=updated,
            previous_progress=current_progress,
            target_state=target_state,
            message="Generation was cancelled.",
            terminal_error_code="generation_cancelled",
        )
        self.notification_repository.create_notification(
            user_id=user_id,
            application_id=application_id,
            notification_type="info",
            message="Generation was cancelled.",
            action_required=False,
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="generation_cancelled",
            status="failure",
            failure_message="Generation was cancelled by user.",
        )

        return self._detail_payload(updated)

    async def cancel_extraction(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)
        current_progress = await self.progress_store.get(application_id)

        if not self._is_extraction_active(record=record, progress=current_progress):
            raise PermissionError("No active extraction to stop.")

        failure_details = ExtractionFailureDetailsPayload(
            kind="user_cancelled",
            blocked_url=record.job_url,
            detected_at=datetime.now(timezone.utc).isoformat(),
        )
        updated = await self._update_application_and_publish_detail(
            application_id=application_id,
            user_id=user_id,
            updates=self._workflow_updates(
                internal_state="manual_entry_required",
                failure_reason="extraction_failed",
                extraction_failure_details=failure_details.model_dump(),
                duplicate_similarity_score=None,
                duplicate_match_fields=None,
                duplicate_resolution_status=None,
                duplicate_matched_application_id=None,
            ),
        )
        self.notification_repository.clear_action_required(user_id=user_id, application_id=application_id)
        await self._set_terminal_extraction_progress(
            record=updated,
            previous_progress=current_progress,
            message="Extraction was stopped. Retry or delete this application.",
            terminal_error_code="extraction_failed",
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="extraction_cancelled",
        )
        return self._detail_payload(updated)

    async def _detect_and_recover_stuck_generation(
        self,
        record: ApplicationRecord,
    ) -> bool:
        """Detect if a generation job has stalled and recover it."""
        current_progress = await self.progress_store.get(record.id)
        if not self._is_generation_active(record=record, progress=current_progress):
            return False

        activity_at = self._parse_timestamp(
            current_progress.updated_at
            if current_progress is not None and current_progress.completed_at is None
            else record.updated_at
        )
        started_at = self._parse_timestamp(
            current_progress.created_at if current_progress is not None else record.updated_at
        )
        if activity_at is None or started_at is None:
            return False

        now = datetime.now(timezone.utc)
        idle_elapsed = (now - activity_at).total_seconds()
        total_elapsed = (now - started_at).total_seconds()
        idle_timeout_seconds, max_timeout_seconds = self._generation_timeout_seconds(record, current_progress)
        if idle_elapsed < idle_timeout_seconds and total_elapsed < max_timeout_seconds:
            return False

        timed_out_for_idle = idle_elapsed >= idle_timeout_seconds
        logger.warning(
            "Recovering stuck generation job %s (state=%s, idle=%.0fs, total=%.0fs)",
            record.id,
            record.internal_state,
            idle_elapsed,
            total_elapsed,
        )

        target_state = self._target_state_after_generation_stop(record, current_progress)
        is_initial_generation = target_state == "generation_pending"
        failure_reason = "generation_timeout" if is_initial_generation else "regeneration_failed"
        workflow_label = "Generation" if is_initial_generation else "Regeneration"
        timeout_message = (
            f"{workflow_label} stalled after {idle_timeout_seconds} seconds without progress. You can retry with the same settings."
            if timed_out_for_idle
            else f"{workflow_label} exceeded the maximum processing window. You can retry with the same settings."
        )
        self._release_generation_quota_for_period(
            user_id=record.user_id,
            period_start=current_progress.quota_period_start if current_progress is not None else None,
        )

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state=target_state,
                failure_reason=failure_reason,
                generation_failure_details={
                    "message": timeout_message,
                },
            ),
        )
        await self._set_terminal_generation_progress(
            record=updated,
            previous_progress=current_progress,
            target_state=target_state,
            message=timeout_message,
            terminal_error_code=failure_reason,
        )
        self.notification_repository.create_notification(
            user_id=record.user_id,
            application_id=record.id,
            notification_type="warning",
            message=timeout_message,
            action_required=True,
        )

        return True

    async def _reconcile_terminal_generation_progress(
        self,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> ApplicationRecord:
        if progress is None or progress.workflow_kind not in {"generation", "regeneration_full", "regeneration_section"}:
            return record

        is_terminal_success = progress.state == "resume_ready" and progress.terminal_error_code is None
        is_terminal_failure = progress.terminal_error_code is not None
        if not is_terminal_success and not is_terminal_failure:
            return record

        if is_terminal_success:
            if record.internal_state == "resume_ready" and record.failure_reason is None:
                return record

            try:
                recovered_success = await self._reconcile_generation_success_from_progress_cache(
                    record=record,
                    progress=progress,
                )
            except ValueError:
                logger.exception("Failed reconciling cached generation success payload for %s", record.id)
                recovered_success = None
            if recovered_success is not None:
                return recovered_success

            workflow_kind = self._generation_workflow_kind(record, progress)
            is_initial_generation = workflow_kind == "generation"
            target_state = self._target_state_after_generation_stop(record, progress)
            failure_reason = "generation_failed" if is_initial_generation else "regeneration_failed"
            sync_failure_message = (
                GENERATION_CALLBACK_SYNC_FAILURE_MESSAGE
                if is_initial_generation
                else REGENERATION_CALLBACK_SYNC_FAILURE_MESSAGE
            )
            normalized_details = self._normalize_generation_failure_details(
                message=sync_failure_message,
                failure_details=None,
            )

            if (
                record.internal_state == target_state
                and record.failure_reason == failure_reason
                and record.generation_failure_details == normalized_details
            ):
                return record

            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state=target_state,
                    failure_reason=failure_reason,
                    generation_failure_details=normalized_details,
                ),
            )
            await self._set_terminal_generation_progress(
                record=updated,
                previous_progress=progress,
                target_state=target_state,
                message=sync_failure_message,
                terminal_error_code=failure_reason,
            )
            try:
                self.notification_repository.clear_action_required(
                    user_id=record.user_id,
                    application_id=record.id,
                )
                self.notification_repository.create_notification(
                    user_id=record.user_id,
                    application_id=record.id,
                    notification_type="error",
                    message=sync_failure_message,
                    action_required=True,
                )
            except Exception:
                logger.exception("Failed reconciling generation callback sync failure notifications for %s", record.id)
            return updated

        failure_reason = self._terminal_failure_reason(record=record, progress=progress)
        target_state = self._target_state_after_generation_stop(record, progress)
        normalized_details = (
            record.generation_failure_details
            if isinstance(record.generation_failure_details, dict) and record.generation_failure_details
            else self._normalize_generation_failure_details(
                message=progress.message,
                failure_details=None,
            )
        )

        if (
            record.internal_state == target_state
            and record.failure_reason == failure_reason
            and record.generation_failure_details == normalized_details
        ):
            return record

        self._release_generation_quota_for_period(
            user_id=record.user_id,
            period_start=progress.quota_period_start,
        )

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state=target_state,
                failure_reason=failure_reason,
                generation_failure_details=normalized_details,
            ),
        )
        try:
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            self.notification_repository.create_notification(
                user_id=record.user_id,
                application_id=record.id,
                notification_type="error",
                message=progress.message,
                action_required=True,
            )
        except Exception:
            logger.exception("Failed reconciling terminal generation notifications for %s", record.id)
        return updated

    async def _reconcile_terminal_extraction_progress(
        self,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> ApplicationRecord:
        if progress is None or progress.workflow_kind != "extraction":
            return record

        is_terminal_failure = progress.terminal_error_code is not None
        is_terminal_success = (
            progress.state == "generation_pending"
            and progress.terminal_error_code is None
            and progress.completed_at is not None
        )
        if not is_terminal_failure and not is_terminal_success:
            return record

        if is_terminal_success:
            if record.internal_state == "generation_pending" and record.failure_reason is None:
                return record

            recovered_success = await self._reconcile_extraction_success_from_progress_cache(
                record=record,
                progress=progress,
            )
            if recovered_success is not None:
                return recovered_success

            failure_details = record.extraction_failure_details
            if not isinstance(failure_details, dict):
                failure_details = None
            if failure_details is None:
                failure_details = {
                    "kind": "callback_delivery_failed",
                    "provider": None,
                    "reference_id": None,
                    "blocked_url": record.job_url,
                    "detected_at": datetime.now(timezone.utc).isoformat(),
                }

            if (
                record.internal_state == "manual_entry_required"
                and record.failure_reason == "extraction_failed"
                and record.extraction_failure_details == failure_details
            ):
                return record

            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="manual_entry_required",
                    failure_reason="extraction_failed",
                    extraction_failure_details=failure_details,
                ),
            )
            await self._set_terminal_extraction_progress(
                record=updated,
                previous_progress=progress,
                message=EXTRACTION_CALLBACK_SYNC_FAILURE_MESSAGE,
                terminal_error_code="extraction_failed",
            )
            try:
                self.notification_repository.clear_action_required(
                    user_id=record.user_id,
                    application_id=record.id,
                )
                self.notification_repository.create_notification(
                    user_id=record.user_id,
                    application_id=record.id,
                    notification_type="error",
                    message=EXTRACTION_CALLBACK_SYNC_FAILURE_MESSAGE,
                    action_required=True,
                )
            except Exception:
                logger.exception("Failed reconciling extraction sync failure notifications for %s", record.id)
            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="extraction",
                event_status="failure",
                metadata={
                    "activity_type": "extraction_failed",
                    "failure_message": EXTRACTION_CALLBACK_SYNC_FAILURE_MESSAGE,
                    "details": {"failure_stage": "callback_sync"},
                },
            )
            return updated

        failure_details = record.extraction_failure_details
        if not isinstance(failure_details, dict):
            failure_details = None
        if failure_details is None and progress.terminal_error_code == "blocked_source":
            failure_details = {
                "kind": "blocked_source",
                "provider": record.job_posting_origin,
                "reference_id": None,
                "blocked_url": record.job_url,
                "detected_at": datetime.now(timezone.utc).isoformat(),
            }

        if (
            record.internal_state == "manual_entry_required"
            and record.failure_reason == "extraction_failed"
            and record.extraction_failure_details == failure_details
        ):
            return record

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="manual_entry_required",
                failure_reason="extraction_failed",
                extraction_failure_details=failure_details,
            ),
        )
        try:
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            self.notification_repository.create_notification(
                user_id=record.user_id,
                application_id=record.id,
                notification_type="error",
                message=progress.message,
                action_required=True,
            )
        except Exception:
            logger.exception("Failed reconciling terminal extraction notifications for %s", record.id)
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="extraction",
            event_status="failure",
            metadata={
                "activity_type": "extraction_failed",
                "failure_message": progress.message,
            },
        )
        return updated

    async def _reconcile_extraction_success_from_progress_cache(
        self,
        *,
        record: ApplicationRecord,
        progress: ProgressRecord,
    ) -> Optional[ApplicationRecord]:
        cached_result = await self.progress_store.get_extraction_result(record.id)
        if not isinstance(cached_result, dict):
            return None

        cached_job_id = str(cached_result.get("job_id") or "").strip()
        if not cached_job_id or cached_job_id != progress.job_id:
            return None

        extracted_payload = cached_result.get("extracted")
        if not isinstance(extracted_payload, dict):
            return None

        try:
            extracted = WorkerSuccessPayload.model_validate(extracted_payload)
        except Exception:
            logger.exception("Failed validating cached extraction payload for %s", record.id)
            return None

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates={
                "job_title": extracted.job_title,
                "company": extracted.company,
                "job_description": extracted.job_description,
                "job_location_text": extracted.job_location_text,
                "compensation_text": extracted.compensation_text,
                "extracted_reference_id": extracted.extracted_reference_id,
                "job_posting_origin": extracted.job_posting_origin,
                "job_posting_origin_other_text": extracted.job_posting_origin_other_text,
                "job_keywords": self._coerce_worker_keyword_payload(
                    job_keywords=extracted.job_keywords,
                    job_description=extracted.job_description,
                ),
                **self._workflow_updates(
                    internal_state="generation_pending",
                    failure_reason=None,
                    extraction_failure_details=None,
                    duplicate_similarity_score=None,
                    duplicate_match_fields=None,
                    duplicate_resolution_status=None,
                    duplicate_matched_application_id=None,
                ),
            },
        )
        await self.progress_store.clear_extraction_result(record.id)
        duration_ms = self._progress_duration_ms(progress)
        details = {}
        if extracted.model_used:
            details["model_used"] = extracted.model_used
        if duration_ms is not None:
            details["duration_ms"] = duration_ms

        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="extraction",
            event_status="success",
            metadata={
                "activity_type": "extraction_succeeded",
                "details": details or None,
            },
        )
        updated = await self._run_duplicate_resolution_flow(updated)
        return await self._enqueue_keyword_extraction_for_record(updated, force=True)

    async def _reconcile_generation_success_from_progress_cache(
        self,
        *,
        record: ApplicationRecord,
        progress: ProgressRecord,
    ) -> Optional[ApplicationRecord]:
        cached_result = await self.progress_store.consume_generation_result(record.id)
        if not isinstance(cached_result, dict):
            return None

        cached_job_id = str(cached_result.get("job_id") or "").strip()
        if not cached_job_id or cached_job_id != progress.job_id:
            return None

        cached_workflow_kind = str(cached_result.get("workflow_kind") or "").strip()
        if cached_workflow_kind and cached_workflow_kind != progress.workflow_kind:
            return None

        generated_payload = cached_result.get("generated")
        if not isinstance(generated_payload, dict):
            return None

        try:
            generated = GenerationSuccessPayload.model_validate(generated_payload)
        except Exception:
            logger.exception("Failed validating cached generation payload for %s", record.id)
            return None

        latest_record = self.repository.fetch_application(record.user_id, record.id)
        if latest_record is not None:
            record = latest_record

        keyword_optimization_failure = self._keyword_optimization_failure_details(
            record=record,
            generated=generated,
        )
        if keyword_optimization_failure is not None:
            return await self._mark_generation_failure(
                record=record,
                message="Keyword optimization did not preserve existing keyword coverage. Your previous draft was kept.",
                failure_details=keyword_optimization_failure,
                failure_reason="regeneration_failed",
            )

        draft = self.draft_repository.upsert_draft(
            application_id=record.id,
            user_id=record.user_id,
            content_md=self._normalize_draft_content(generated.content_md),
            generation_params=generated.generation_params,
            sections_snapshot=generated.sections_snapshot,
        )

        updated = await self._enqueue_resume_judge_for_draft(
            record=record,
            draft=draft,
            application_updates=self._workflow_updates(
                internal_state="resume_ready",
                failure_reason=None,
                generation_failure_details=None,
            ),
        )
        try:
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            if progress.workflow_kind == "generation":
                self.notification_repository.create_notification(
                    user_id=record.user_id,
                    application_id=record.id,
                    notification_type="success",
                    message="Resume generation completed successfully.",
                    action_required=False,
                )
                await self._send_generation_email(
                    record=updated,
                    subject="Applix: resume generated",
                    body="Your tailored resume has been generated and is ready for review.",
                )
                details: dict[str, Any] = {}
                model_used = generated.generation_params.get("model_used")
                if model_used:
                    details["model_used"] = model_used
                length_diagnostics = self._length_diagnostics_for_activity(generated.length_diagnostics)
                if length_diagnostics:
                    details["length_diagnostics"] = length_diagnostics
                self._record_usage_event(
                    user_id=record.user_id,
                    application_id=record.id,
                    event_type="generation",
                    event_status="success",
                    metadata={
                        "activity_type": "generation_succeeded",
                        "details": details or None,
                    },
                )
            else:
                optimization = generated.generation_params.get("keyword_optimization")
                is_keyword_optimization = isinstance(optimization, dict) and bool(optimization.get("enabled"))
                self.notification_repository.create_notification(
                    user_id=record.user_id,
                    application_id=record.id,
                    notification_type="success",
                    message=(
                        "Resume keyword optimization completed successfully."
                        if is_keyword_optimization
                        else "Resume regeneration completed successfully."
                    ),
                    action_required=False,
                )
                await self._send_generation_email(
                    record=updated,
                    subject="Applix: resume optimized" if is_keyword_optimization else "Applix: resume regenerated",
                    body=(
                        "Your resume has been optimized for ATS keywords and is ready for review."
                        if is_keyword_optimization
                        else "Your resume has been regenerated and is ready for review."
                    ),
                )
                details: dict[str, Any] = {}
                model_used = generated.generation_params.get("model_used")
                if model_used:
                    details["model_used"] = model_used
                length_diagnostics = self._length_diagnostics_for_activity(generated.length_diagnostics)
                if length_diagnostics:
                    details["length_diagnostics"] = length_diagnostics
                self._record_usage_event(
                    user_id=record.user_id,
                    application_id=record.id,
                    event_type="regeneration",
                    event_status="success",
                    metadata={
                        "activity_type": (
                            "keyword_optimization_succeeded"
                            if is_keyword_optimization
                            else "regeneration_full_succeeded"
                        ),
                        "details": details or None,
                    },
                )
        except Exception:
            logger.exception("Failed reconciling cached generation success notifications for %s", record.id)
        return updated

    def _terminal_failure_reason(
        self,
        *,
        record: ApplicationRecord,
        progress: ProgressRecord,
    ) -> str:
        terminal_code = progress.terminal_error_code or "generation_failed"
        workflow_kind = self._generation_workflow_kind(record, progress)

        if workflow_kind == "generation":
            if terminal_code == "generation_timeout":
                return "generation_timeout"
            if terminal_code == "generation_cancelled":
                return "generation_cancelled"
            return "generation_failed"

        return "regeneration_failed"

    async def get_progress(self, *, user_id: str, application_id: str) -> ProgressRecord:
        record = self._require_application(user_id=user_id, application_id=application_id)
        record = await self._recover_stuck_generation_if_needed(record)
        progress = await self.progress_store.get(application_id)
        record = await self._reconcile_terminal_extraction_progress(record, progress)
        progress = await self.progress_store.get(application_id)
        if progress is not None:
            if (
                (record.failure_reason is not None or record.internal_state == "resume_ready")
                and progress.completed_at is None
                and progress.terminal_error_code is None
            ):
                synthesized = build_progress(
                    job_id=f"state-{application_id}",
                    workflow_kind=progress.workflow_kind,
                    state=record.internal_state,
                    message=self._default_progress_message(record),
                    percent_complete=100,
                    completed_at=record.updated_at,
                    terminal_error_code=record.failure_reason,
                    created_at=progress.created_at,
                )
                await self.progress_store.set(application_id, synthesized)
                return synthesized
            return progress

        return build_progress(
            job_id=f"state-{application_id}",
            state=record.internal_state,
            message=self._default_progress_message(record),
            percent_complete=100 if record.failure_reason else 0,
            completed_at=record.updated_at if record.failure_reason else None,
            terminal_error_code=record.failure_reason,
            created_at=record.created_at,
        )

    async def handle_worker_callback(self, payload: WorkerCallbackPayload) -> ApplicationRecord:
        record = self.repository.fetch_application_unscoped(payload.application_id)
        if record is None:
            raise LookupError("Application not found.")
        if record.user_id != payload.user_id:
            raise PermissionError("Worker payload user mismatch.")

        current_progress = await self.progress_store.get(record.id)
        if current_progress is not None and current_progress.job_id != payload.job_id:
            return record

        if payload.event == "started":
            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="extracting",
                    failure_reason=None,
                    extraction_failure_details=None,
                ),
            )
            self._record_activity_event(
                user_id=record.user_id,
                application_id=record.id,
                activity_type="extraction_started",
            )
            return updated

        if payload.event == "failed":
            return await self._mark_extraction_failure(
                record=record,
                message=(payload.failure.message if payload.failure else "Extraction failed."),
                failure_details=(payload.failure.failure_details if payload.failure else None),
            )

        if payload.event == "succeeded":
            if payload.extracted is None:
                raise ValueError("Missing extracted payload for success callback.")

            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_title": payload.extracted.job_title,
                    "company": payload.extracted.company,
                    "job_description": payload.extracted.job_description,
                    "job_location_text": payload.extracted.job_location_text,
                    "compensation_text": payload.extracted.compensation_text,
                    "extracted_reference_id": payload.extracted.extracted_reference_id,
                    "job_posting_origin": payload.extracted.job_posting_origin,
                    "job_posting_origin_other_text": payload.extracted.job_posting_origin_other_text,
                    "job_keywords": self._coerce_worker_keyword_payload(
                        job_keywords=payload.extracted.job_keywords,
                        job_description=payload.extracted.job_description,
                    ),
                    **self._workflow_updates(
                        internal_state="generation_pending",
                        failure_reason=None,
                        extraction_failure_details=None,
                        duplicate_similarity_score=None,
                        duplicate_match_fields=None,
                        duplicate_resolution_status=None,
                        duplicate_matched_application_id=None,
                    ),
                },
            )
            duration_ms = self._calculate_duration_ms(
                current_progress.created_at if current_progress else None
            )

            details = {}
            if payload.extracted.model_used:
                details["model_used"] = payload.extracted.model_used
            if duration_ms is not None:
                details["duration_ms"] = duration_ms

            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="extraction",
                event_status="success",
                metadata={
                    "activity_type": "extraction_succeeded",
                    "details": details or None,
                },
            )
            updated = await self._run_duplicate_resolution_flow(updated)
            return await self._enqueue_keyword_extraction_for_record(updated, force=True)

        raise ValueError("Unsupported worker event.")

    async def trigger_generation(
        self,
        *,
        user_id: str,
        application_id: str,
        base_resume_id: str,
        target_length: str,
        aggressiveness: str,
        additional_instructions: Optional[str] = None,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)

        if record.internal_state == "manual_entry_required":
            raise PermissionError("Submit manual entry before generating.")

        if record.internal_state == "duplicate_review_required":
            raise PermissionError(GENERATION_DUPLICATE_BLOCKER_MESSAGE)

        if record.internal_state not in ("generation_pending", "resume_ready"):
            raise PermissionError("Application is not ready for generation.")

        if not record.job_title or not record.job_description:
            raise ValueError("Job title and description are required before generation.")

        if self._looks_like_blocked_source_placeholder(record):
            return await self._route_blocked_job_data_to_manual_entry(record)

        if record.duplicate_resolution_status == "pending":
            raise PermissionError(GENERATION_DUPLICATE_BLOCKER_MESSAGE)

        base_resume = self.base_resume_repository.fetch_resume(user_id, base_resume_id)
        if base_resume is None:
            raise LookupError("Base resume not found.")

        profile = self._require_profile(user_id=user_id, action="generating a resume")
        self._require_profile_name(profile, action="generating a resume")
        personal_info = self._build_personal_info(profile)

        section_prefs = self._build_section_preferences(profile)
        quota_reservation = self._reserve_generation_quota(user_id=user_id)

        generation_settings = {
            "page_length": target_length,
            "aggressiveness": aggressiveness,
            "additional_instructions": additional_instructions,
            "base_resume_id": base_resume_id,
            **self._keyword_generation_settings(record=record, aggressiveness=aggressiveness),
            "_base_resume_snapshot_content": base_resume.content_md,
            **self._quota_generation_settings(quota_reservation),
        }

        updated = None
        job_queued = False
        try:
            updated = self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates={
                    "base_resume_id": base_resume_id,
                    **self._workflow_updates(
                        internal_state="generating",
                        failure_reason=None,
                        generation_failure_details=None,
                    ),
                },
            )
            self.notification_repository.clear_action_required(
                user_id=user_id, application_id=application_id,
            )
            enqueue_started_at = perf_counter()
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_start",
                    "workflow_kind": "generation",
                    "user_id": user_id,
                    "application_id": application_id,
                    "base_resume_id": base_resume_id,
                    "target_length": target_length,
                    "aggressiveness": aggressiveness,
                    "has_additional_instructions": bool(additional_instructions),
                },
            )
            job_id = await self.generation_job_queue.enqueue(
                application_id=application_id,
                user_id=user_id,
                job_title=record.job_title,
                company_name=record.company,
                job_description=record.job_description,
                base_resume_content=base_resume.content_md,
                personal_info=personal_info,
                section_preferences=section_prefs,
                generation_settings=generation_settings,
            )
            job_queued = True
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_success",
                    "workflow_kind": "generation",
                    "user_id": user_id,
                    "application_id": application_id,
                    "job_id": job_id,
                    "latency_ms": round((perf_counter() - enqueue_started_at) * 1000),
                },
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    workflow_kind="generation",
                    state="generation_pending",
                    message="Resume generation is queued.",
                    percent_complete=0,
                    quota_period_start=quota_reservation.period_start,
                ),
            )
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="generation_started",
                details={
                    "page_length": target_length,
                    "aggressiveness": aggressiveness,
                },
            )
            return self._detail_payload(updated)
        except Exception as error:
            if not job_queued:
                self._release_generation_quota(user_id=user_id, reservation=quota_reservation)
            logger.warning(
                "generation_enqueue %s",
                {
                    "event": "enqueue_failure",
                    "workflow_kind": "generation",
                    "user_id": user_id,
                    "application_id": application_id,
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )
            if updated is None:
                raise
            failed = await self._mark_generation_failure(
                record=updated,
                message="Generation could not be started. Try again or adjust settings.",
                failure_details={
                    "failure_stage": "enqueue",
                    "terminal_error_code": "generation_failed",
                    "error": {
                        "error_type": type(error).__name__,
                        "message": str(error),
                    },
                },
            )
            return self._detail_payload(failed)

    async def handle_generation_callback(
        self, payload: GenerationCallbackPayload,
    ) -> ApplicationRecord:
        record = self.repository.fetch_application_unscoped(payload.application_id)
        if record is None:
            raise LookupError("Application not found.")
        if record.user_id != payload.user_id:
            raise PermissionError("Worker payload user mismatch.")

        current_progress = await self.progress_store.get(record.id)
        if current_progress is not None and current_progress.job_id != payload.job_id:
            return record

        if payload.event == "started":
            await self.progress_store.clear_generation_result(record.id)
            await self.progress_store.set(
                record.id,
                build_progress(
                    job_id=payload.job_id,
                    workflow_kind="generation",
                    state="generating",
                    message="Resume generation is running.",
                    percent_complete=25,
                ),
            )
            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="generating",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            return updated

        if payload.event == "progress" and current_progress is not None:
            current_progress.percent_complete = min(
                current_progress.percent_complete + 15, 90,
            )
            current_progress.updated_at = build_progress(
                job_id=payload.job_id, state="generating",
                message="Generation in progress.", percent_complete=0,
            ).updated_at
            await self.progress_store.set(record.id, current_progress)
            return record

        if payload.event == "failed":
            await self.progress_store.clear_generation_result(record.id)
            failure_msg = payload.failure.message if payload.failure else "Generation failed."
            failure_details = payload.failure.failure_details if payload.failure else None
            terminal_code = payload.failure.terminal_error_code if payload.failure else "generation_failed"
            failure_reason = (
                terminal_code
                if terminal_code in {"generation_failed", "generation_timeout"}
                else "generation_failed"
            )

            completed_progress = build_progress(
                job_id=payload.job_id,
                workflow_kind="generation",
                state="generation_failed",
                message=failure_msg,
                percent_complete=100,
                terminal_error_code=terminal_code,
                quota_period_start=payload.quota_period_start,
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)
            self._release_generation_quota_for_period(
                user_id=record.user_id,
                period_start=payload.quota_period_start,
            )

            return await self._mark_generation_failure(
                record=record,
                message=failure_msg,
                failure_details=failure_details,
                failure_reason=failure_reason,
            )

        if payload.event == "succeeded":
            if payload.generated is None:
                raise ValueError("Missing generated payload for success callback.")

            draft = self.draft_repository.upsert_draft(
                application_id=record.id,
                user_id=record.user_id,
                content_md=self._normalize_draft_content(payload.generated.content_md),
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = await self._enqueue_resume_judge_for_draft(
                record=record,
                draft=draft,
                application_updates=self._workflow_updates(
                    internal_state="resume_ready",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )

            completed_progress = build_progress(
                job_id=payload.job_id,
                workflow_kind="generation",
                state="resume_ready",
                message="Resume generation completed.",
                percent_complete=100,
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)
            await self.progress_store.clear_generation_result(record.id)

            self.notification_repository.clear_action_required(
                user_id=record.user_id, application_id=record.id,
            )
            self.notification_repository.create_notification(
                user_id=record.user_id,
                application_id=record.id,
                notification_type="success",
                message="Resume generation completed successfully.",
                action_required=False,
            )
            await self._send_generation_email(
                record=updated,
                subject="Applix: resume generated",
                body="Your tailored resume has been generated and is ready for review.",
            )
            model_used = str(payload.generated.generation_params.get("model_used") or "").strip() or None
            duration_ms = None
            if current_progress is not None:
                duration_ms = self._calculate_duration_ms(
                    current_progress.created_at,
                    completed_progress.updated_at
                )
            if duration_ms is None:
                duration_ms = self._progress_duration_ms(completed_progress)

            details: dict[str, Any] = {}
            if model_used:
                details["model_used"] = model_used
            if duration_ms is not None:
                details["duration_ms"] = duration_ms
            length_diagnostics = self._length_diagnostics_for_activity(payload.generated.length_diagnostics)
            if length_diagnostics:
                details["length_diagnostics"] = length_diagnostics
            attempts = payload.generated.attempts
            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="generation",
                event_status="success",
                metadata={
                    "activity_type": "generation_succeeded",
                    "details": details or None,
                    "attempts": attempts,
                },
            )
            return updated

        raise ValueError("Unsupported generation callback event.")

    async def trigger_full_regeneration(
        self,
        *,
        user_id: str,
        application_id: str,
        target_length: str,
        aggressiveness: str,
        additional_instructions: Optional[str] = None,
        use_judge_feedback: bool = False,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)

        if record.internal_state not in ("resume_ready",):
            raise PermissionError("Application must have an existing draft for regeneration.")

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No existing draft found for regeneration.")

        if not record.job_title or not record.job_description:
            raise ValueError("Job title and description are required for regeneration.")

        if self._looks_like_blocked_source_placeholder(record):
            return await self._route_blocked_job_data_to_manual_entry(record)

        base_resume_id = record.base_resume_id
        if not base_resume_id:
            raise ValueError("A base resume must be linked to the application for regeneration.")

        base_resume = self.base_resume_repository.fetch_resume(user_id, base_resume_id)
        if base_resume is None:
            raise LookupError("Linked base resume not found.")

        profile = self._require_profile(user_id=user_id, action="regenerating the full resume")
        self._require_profile_name(profile, action="regenerating the full resume")
        personal_info = self._build_personal_info(profile)

        section_prefs = self._build_section_preferences(profile)
        quota_reservation = self._reserve_generation_quota(user_id=user_id)
        judge_instructions = self._get_judge_instructions(record.resume_judge_result)
        effective_additional_instructions = additional_instructions
        if use_judge_feedback and judge_instructions:
            trimmed_base = (additional_instructions or "").strip()
            feedback_block = f"Resume Judge Feedback:\n{judge_instructions}"
            effective_additional_instructions = (
                f"{trimmed_base}\n\n{feedback_block}" if trimmed_base else feedback_block
            )
        generation_settings = {
            "page_length": target_length,
            "aggressiveness": aggressiveness,
            "additional_instructions": effective_additional_instructions,
            "use_judge_feedback": use_judge_feedback,
            "base_resume_id": base_resume_id,
            **self._keyword_generation_settings(record=record, aggressiveness=aggressiveness),
            "_base_resume_snapshot_content": base_resume.content_md,
            **self._quota_generation_settings(quota_reservation),
        }

        updated = None
        job_queued = False
        try:
            updated = self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates=self._workflow_updates(
                    internal_state="regenerating_full",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            self.notification_repository.clear_action_required(
                user_id=user_id, application_id=application_id,
            )
            enqueue_started_at = perf_counter()
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_start",
                    "workflow_kind": "regeneration_full",
                    "user_id": user_id,
                    "application_id": application_id,
                    "target_length": target_length,
                    "aggressiveness": aggressiveness,
                    "has_additional_instructions": bool(additional_instructions),
                },
            )
            job_id = await self.generation_job_queue.enqueue_regeneration(
                application_id=application_id,
                user_id=user_id,
                job_title=record.job_title,
                company_name=record.company,
                job_description=record.job_description,
                base_resume_content=base_resume.content_md,
                current_draft_content=draft.content_md,
                personal_info=personal_info,
                section_preferences=section_prefs,
                generation_settings=generation_settings,
                regeneration_target="full",
                regeneration_instructions=effective_additional_instructions,
            )
            job_queued = True
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_success",
                    "workflow_kind": "regeneration_full",
                    "user_id": user_id,
                    "application_id": application_id,
                    "job_id": job_id,
                    "latency_ms": round((perf_counter() - enqueue_started_at) * 1000),
                },
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    workflow_kind="regeneration_full",
                    state="regenerating_full",
                    message="Full resume regeneration is queued.",
                    percent_complete=0,
                    quota_period_start=quota_reservation.period_start,
                ),
            )
            title = "Regeneration with Judge Feedback started" if use_judge_feedback else None
            summary = "Full resume regeneration with Resume Judge feedback started." if use_judge_feedback else None
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="regeneration_full_started",
                title=title,
                summary=summary,
                details={
                    "page_length": target_length,
                    "aggressiveness": aggressiveness,
                    "additional_instructions": additional_instructions or None,
                    "use_judge_feedback": use_judge_feedback,
                    "regeneration_instructions": judge_instructions or None,
                },
            )
            return self._detail_payload(updated)
        except Exception as error:
            if not job_queued:
                self._release_generation_quota(user_id=user_id, reservation=quota_reservation)
            logger.warning(
                "generation_enqueue %s",
                {
                    "event": "enqueue_failure",
                    "workflow_kind": "regeneration_full",
                    "user_id": user_id,
                    "application_id": application_id,
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )
            if updated is None:
                raise
            failed = await self._mark_generation_failure(
                record=updated,
                message="Full regeneration could not be started. Try again.",
                failure_details={
                    "failure_stage": "enqueue",
                    "terminal_error_code": "regeneration_failed",
                    "error": {
                        "error_type": type(error).__name__,
                        "message": str(error),
                    },
                },
                failure_reason="regeneration_failed",
            )
            return self._detail_payload(failed)

    async def trigger_keyword_optimization(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)

        if record.internal_state not in ("resume_ready",):
            raise PermissionError("Application must have an existing ready draft for keyword optimization.")

        keyword_status = str((record.job_keywords or {}).get("status") or "").strip().lower()
        if keyword_status in {"queued", "running"}:
            raise PermissionError("Keyword extraction must finish before keyword optimization.")

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No existing draft found for keyword optimization.")

        if not record.job_title or not record.job_description:
            raise ValueError("Job title and description are required for keyword optimization.")

        if self._looks_like_blocked_source_placeholder(record):
            return await self._route_blocked_job_data_to_manual_entry(record)

        base_resume_id = str(draft.generation_params.get("base_resume_id") or record.base_resume_id or "").strip()
        if not base_resume_id:
            raise ValueError("A base resume must be linked to the application for keyword optimization.")

        base_resume = self.base_resume_repository.fetch_resume(user_id, base_resume_id)
        if base_resume is None:
            raise LookupError("Linked base resume not found.")

        keyword_match = self._build_keyword_match_for_draft(record=record, draft=draft)
        if keyword_match is None or keyword_match["total_count"] <= 0:
            raise ValueError("No ATS keywords are available for optimization.")
        if not keyword_match["missing_keywords"]:
            raise ValueError("All available ATS keywords are already matched.")

        profile = self._require_profile(user_id=user_id, action="optimizing keywords")
        self._require_profile_name(profile, action="optimizing keywords")
        personal_info = self._build_personal_info(profile)

        section_prefs = self._section_preferences_for_existing_draft(
            draft=draft,
            fallback=self._build_section_preferences(profile),
        )
        # Keyword optimization uses monthly resume_generation_usage quota; full_regeneration_count is legacy.
        quota_reservation = self._reserve_generation_quota(user_id=user_id)
        aggressiveness = str(draft.generation_params.get("aggressiveness") or "medium").strip().lower()
        if aggressiveness not in KEYWORD_COVERAGE_TARGETS:
            aggressiveness = "medium"
        target_length = str(
            draft.generation_params.get("page_length")
            or draft.generation_params.get("target_length")
            or "1_page"
        ).strip() or "1_page"
        additional_instructions = draft.generation_params.get("additional_instructions")
        sanitized_current_draft = sanitize_resume_markdown(draft.content_md).sanitized_markdown or draft.content_md.strip()

        generation_settings = {
            "page_length": target_length,
            "aggressiveness": aggressiveness,
            "additional_instructions": additional_instructions,
            "base_resume_id": base_resume_id,
            **self._keyword_generation_settings(record=record, aggressiveness=aggressiveness),
            "keyword_optimization": {
                "enabled": True,
                "target_keywords": keyword_match["missing_keywords"],
                "preserve_keywords": keyword_match["matched_keywords"],
                "starting_match": keyword_match,
            },
            "_current_draft_snapshot_content": sanitized_current_draft,
            "_base_resume_snapshot_content": base_resume.content_md,
            **self._quota_generation_settings(quota_reservation),
        }

        updated = None
        job_queued = False
        try:
            updated = self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates=self._workflow_updates(
                    internal_state="regenerating_full",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            self.notification_repository.clear_action_required(
                user_id=user_id, application_id=application_id,
            )
            enqueue_started_at = perf_counter()
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_start",
                    "workflow_kind": "regeneration_full",
                    "regeneration_target": KEYWORD_OPTIMIZATION_TARGET,
                    "user_id": user_id,
                    "application_id": application_id,
                    "missing_keyword_count": len(keyword_match["missing_keywords"]),
                },
            )
            job_id = await self.generation_job_queue.enqueue_regeneration(
                application_id=application_id,
                user_id=user_id,
                job_title=record.job_title,
                company_name=record.company,
                job_description=record.job_description,
                base_resume_content=base_resume.content_md,
                current_draft_content=draft.content_md,
                personal_info=personal_info,
                section_preferences=section_prefs,
                generation_settings=generation_settings,
                regeneration_target=KEYWORD_OPTIMIZATION_TARGET,
                regeneration_instructions=None,
            )
            job_queued = True
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_success",
                    "workflow_kind": "regeneration_full",
                    "regeneration_target": KEYWORD_OPTIMIZATION_TARGET,
                    "user_id": user_id,
                    "application_id": application_id,
                    "job_id": job_id,
                    "latency_ms": round((perf_counter() - enqueue_started_at) * 1000),
                },
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    workflow_kind="regeneration_full",
                    state="regenerating_full",
                    message="Keyword optimization is queued.",
                    percent_complete=0,
                    quota_period_start=quota_reservation.period_start,
                ),
            )
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="keyword_optimization_started",
                details={
                    "target_keyword_count": len(keyword_match["missing_keywords"]),
                    "preserve_keyword_count": len(keyword_match["matched_keywords"]),
                    "starting_percentage": keyword_match["percentage"],
                },
            )
            return self._detail_payload(updated)
        except Exception as error:
            if not job_queued:
                self._release_generation_quota(user_id=user_id, reservation=quota_reservation)
            logger.warning(
                "generation_enqueue %s",
                {
                    "event": "enqueue_failure",
                    "workflow_kind": "regeneration_full",
                    "regeneration_target": KEYWORD_OPTIMIZATION_TARGET,
                    "user_id": user_id,
                    "application_id": application_id,
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )
            if updated is None:
                raise
            failed = await self._mark_generation_failure(
                record=updated,
                message="Keyword optimization could not be started. Try again.",
                failure_details={
                    "failure_stage": "enqueue",
                    "terminal_error_code": "regeneration_failed",
                    "error": {
                        "error_type": type(error).__name__,
                        "message": str(error),
                    },
                },
                failure_reason="regeneration_failed",
            )
            return self._detail_payload(failed)

    async def trigger_section_regeneration(
        self,
        *,
        user_id: str,
        application_id: str,
        section_name: str,
        instructions: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)

        if record.internal_state not in ("resume_ready",):
            raise PermissionError("Application must have an existing draft for section regeneration.")

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No existing draft found for section regeneration.")

        if not instructions or not instructions.strip():
            raise ValueError("Instructions are required for section regeneration.")

        if not record.job_title or not record.job_description:
            raise ValueError("Job title and description are required for regeneration.")

        if self._looks_like_blocked_source_placeholder(record):
            return await self._route_blocked_job_data_to_manual_entry(record)

        base_resume_id = record.base_resume_id
        if not base_resume_id:
            raise ValueError("A base resume must be linked to the application for regeneration.")

        base_resume = self.base_resume_repository.fetch_resume(user_id, base_resume_id)
        if base_resume is None:
            raise LookupError("Linked base resume not found.")

        profile = self.profile_repository.fetch_profile(user_id)
        if profile is None:
            raise ValueError("User profile is required for regeneration.")

        personal_info = self._build_personal_info(profile)

        section_prefs = self._build_section_preferences(profile)
        quota_reservation = self._reserve_generation_quota(user_id=user_id)
        generation_settings = {
            **draft.generation_params,
            "base_resume_id": base_resume_id,
            "instructions": instructions.strip(),
            **self._keyword_generation_settings(
                record=record,
                aggressiveness=str(draft.generation_params.get("aggressiveness") or "medium"),
            ),
            "_base_resume_snapshot_content": base_resume.content_md,
            **self._quota_generation_settings(quota_reservation),
        }

        updated = None
        job_queued = False
        try:
            updated = self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates=self._workflow_updates(
                    internal_state="regenerating_section",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            self.notification_repository.clear_action_required(
                user_id=user_id, application_id=application_id,
            )
            enqueue_started_at = perf_counter()
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_start",
                    "workflow_kind": "regeneration_section",
                    "user_id": user_id,
                    "application_id": application_id,
                    "section_name": section_name,
                    "instructions_length": len(instructions.strip()),
                },
            )
            job_id = await self.generation_job_queue.enqueue_regeneration(
                application_id=application_id,
                user_id=user_id,
                job_title=record.job_title,
                company_name=record.company,
                job_description=record.job_description,
                base_resume_content=base_resume.content_md,
                current_draft_content=draft.content_md,
                personal_info=personal_info,
                section_preferences=section_prefs,
                generation_settings=generation_settings,
                regeneration_target=section_name,
                regeneration_instructions=instructions.strip(),
            )
            job_queued = True
            logger.info(
                "generation_enqueue %s",
                {
                    "event": "enqueue_success",
                    "workflow_kind": "regeneration_section",
                    "user_id": user_id,
                    "application_id": application_id,
                    "job_id": job_id,
                    "latency_ms": round((perf_counter() - enqueue_started_at) * 1000),
                },
            )
            await self.progress_store.set(
                application_id,
                build_progress(
                    job_id=job_id,
                    workflow_kind="regeneration_section",
                    state="regenerating_section",
                    message=f"Section regeneration ({section_name}) is queued.",
                    percent_complete=0,
                    quota_period_start=quota_reservation.period_start,
                ),
            )
            judge_instructions = self._get_judge_instructions(record.resume_judge_result)
            self._record_activity_event(
                user_id=user_id,
                application_id=application_id,
                activity_type="regeneration_section_started",
                details={
                    "section_name": section_name,
                    "instructions": instructions.strip(),
                    "regeneration_instructions": judge_instructions or None,
                },
            )
            return self._detail_payload(updated)
        except Exception as error:
            if not job_queued:
                self._release_generation_quota(user_id=user_id, reservation=quota_reservation)
            logger.warning(
                "generation_enqueue %s",
                {
                    "event": "enqueue_failure",
                    "workflow_kind": "regeneration_section",
                    "user_id": user_id,
                    "application_id": application_id,
                    "section_name": section_name,
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )
            if updated is None:
                raise
            failed = await self._mark_generation_failure(
                record=updated,
                message="Section regeneration could not be started. Try again.",
                failure_details={
                    "failure_stage": "enqueue",
                    "terminal_error_code": "regeneration_failed",
                    "section_name": section_name,
                    "error": {
                        "error_type": type(error).__name__,
                        "message": str(error),
                    },
                },
                failure_reason="regeneration_failed",
            )
            return self._detail_payload(failed)

    async def trigger_resume_judge(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)
        if record.internal_state not in ("resume_ready",):
            raise PermissionError("Application must have an existing ready draft for Resume Judge.")

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No existing draft found for Resume Judge.")

        updated = await self._enqueue_resume_judge_for_draft(
            record=record,
            draft=draft,
            force=True,
        )
        return self._detail_payload(updated)

    async def handle_regeneration_callback(
        self, payload: RegenerationCallbackPayload,
    ) -> ApplicationRecord:
        record = self.repository.fetch_application_unscoped(payload.application_id)
        if record is None:
            raise LookupError("Application not found.")
        if record.user_id != payload.user_id:
            raise PermissionError("Worker payload user mismatch.")

        current_progress = await self.progress_store.get(record.id)
        if current_progress is not None and current_progress.job_id != payload.job_id:
            return record

        is_keyword_optimization = payload.regeneration_target == KEYWORD_OPTIMIZATION_TARGET
        is_section = payload.regeneration_target not in {"full", KEYWORD_OPTIMIZATION_TARGET}
        workflow_kind = "regeneration_section" if is_section else "regeneration_full"
        generating_state = "regenerating_section" if is_section else "regenerating_full"
        failure_reason = "regeneration_failed"

        if payload.event == "started":
            await self.progress_store.clear_generation_result(record.id)
            await self.progress_store.set(
                record.id,
                build_progress(
                    job_id=payload.job_id,
                    workflow_kind=workflow_kind,
                    state=generating_state,
                    message="Regeneration is running.",
                    percent_complete=25,
                ),
            )
            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state=generating_state,
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            return updated

        if payload.event == "failed":
            await self.progress_store.clear_generation_result(record.id)
            failure_msg = payload.failure.message if payload.failure else "Regeneration failed."
            failure_details = payload.failure.failure_details if payload.failure else None
            if is_section:
                failure_details = dict(failure_details) if isinstance(failure_details, dict) else {}
                failure_details["section_name"] = payload.regeneration_target

            completed_progress = build_progress(
                job_id=payload.job_id,
                workflow_kind=workflow_kind,
                state="regeneration_failed",
                message=failure_msg,
                percent_complete=100,
                terminal_error_code=failure_reason,
                quota_period_start=payload.quota_period_start,
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)
            self._release_generation_quota_for_period(
                user_id=record.user_id,
                period_start=payload.quota_period_start,
            )

            return await self._mark_generation_failure(
                record=record,
                message=failure_msg,
                failure_details=failure_details,
                failure_reason=failure_reason,
            )

        if payload.event == "succeeded":
            if payload.generated is None:
                raise ValueError("Missing generated payload for regeneration success callback.")

            keyword_optimization_failure = self._keyword_optimization_failure_details(
                record=record,
                generated=payload.generated,
            )
            if keyword_optimization_failure is not None:
                completed_progress = build_progress(
                    job_id=payload.job_id,
                    workflow_kind=workflow_kind,
                    state="regeneration_failed",
                    message="Keyword optimization did not preserve existing keyword coverage. Your previous draft was kept.",
                    percent_complete=100,
                    terminal_error_code="regeneration_failed",
                    quota_period_start=payload.quota_period_start,
                )
                completed_progress.completed_at = completed_progress.updated_at
                await self.progress_store.set(record.id, completed_progress)
                await self.progress_store.clear_generation_result(record.id)
                return await self._mark_generation_failure(
                    record=record,
                    message="Keyword optimization did not preserve existing keyword coverage. Your previous draft was kept.",
                    failure_details=keyword_optimization_failure,
                    failure_reason="regeneration_failed",
                )

            draft = self.draft_repository.upsert_draft(
                application_id=record.id,
                user_id=record.user_id,
                content_md=self._normalize_draft_content(payload.generated.content_md),
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = await self._enqueue_resume_judge_for_draft(
                record=record,
                draft=draft,
                application_updates=self._workflow_updates(
                    internal_state="resume_ready",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )

            completed_progress = build_progress(
                job_id=payload.job_id,
                workflow_kind=workflow_kind,
                state="resume_ready",
                message="Regeneration completed.",
                percent_complete=100,
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)
            await self.progress_store.clear_generation_result(record.id)

            self.notification_repository.clear_action_required(
                user_id=record.user_id, application_id=record.id,
            )
            self.notification_repository.create_notification(
                user_id=record.user_id,
                application_id=record.id,
                notification_type="success",
                message=(
                    "Resume keyword optimization completed successfully."
                    if is_keyword_optimization
                    else "Resume regeneration completed successfully."
                ),
                action_required=False,
            )
            await self._send_generation_email(
                record=updated,
                subject="Applix: resume optimized" if is_keyword_optimization else "Applix: resume regenerated",
                body=(
                    "Your resume has been optimized for ATS keywords and is ready for review."
                    if is_keyword_optimization
                    else "Your resume has been regenerated and is ready for review."
                ),
            )
            model_used = str(payload.generated.generation_params.get("model_used") or "").strip() or None
            duration_ms = None
            if current_progress is not None:
                duration_ms = self._calculate_duration_ms(
                    current_progress.created_at,
                    completed_progress.updated_at
                )
            if duration_ms is None:
                duration_ms = self._progress_duration_ms(completed_progress)

            use_judge_feedback = bool(payload.generated.generation_params.get("use_judge_feedback"))
            additional_instructions = payload.generated.generation_params.get("additional_instructions")
            instructions = payload.generated.generation_params.get("instructions")

            judge_instructions = self._get_judge_instructions(record.resume_judge_result)

            details: dict[str, Any] = {}
            if model_used:
                details["model_used"] = model_used
            if duration_ms is not None:
                details["duration_ms"] = duration_ms
            length_diagnostics = self._length_diagnostics_for_activity(payload.generated.length_diagnostics)
            if length_diagnostics:
                details["length_diagnostics"] = length_diagnostics

            if is_section:
                details["section_name"] = payload.regeneration_target
                if instructions:
                    details["instructions"] = instructions
            elif is_keyword_optimization:
                optimization = payload.generated.generation_params.get("keyword_optimization")
                if isinstance(optimization, dict):
                    details["target_keyword_count"] = len(optimization.get("target_keywords") or [])
                    details["preserve_keyword_count"] = len(optimization.get("preserve_keywords") or [])
            else:
                if additional_instructions:
                    details["additional_instructions"] = additional_instructions
                details["use_judge_feedback"] = use_judge_feedback

            if judge_instructions:
                details["regeneration_instructions"] = judge_instructions

            title = None
            summary = None
            activity_type = "regeneration_section_succeeded" if is_section else "regeneration_full_succeeded"
            if is_keyword_optimization:
                activity_type = "keyword_optimization_succeeded"
                title = "Keyword optimization completed"
                summary = "Resume keyword optimization completed."
            elif not is_section and use_judge_feedback:
                title = "Regeneration with Judge Feedback completed"
                summary = "Full resume regeneration with Resume Judge feedback completed."

            attempts = payload.generated.attempts
            self._record_activity_event(
                user_id=record.user_id,
                application_id=record.id,
                activity_type=activity_type,
                title=title,
                summary=summary,
                status="success",
                details=details or None,
                attempts=attempts,
            )
            return updated

        raise ValueError("Unsupported regeneration callback event.")

    async def handle_resume_judge_callback(
        self, payload: ResumeJudgeCallbackPayload,
    ) -> ApplicationRecord:
        record = self.repository.fetch_application_unscoped(payload.application_id)
        if record is None:
            raise LookupError("Application not found.")
        if record.user_id != payload.user_id:
            raise PermissionError("Worker payload user mismatch.")

        current_job_context_signature = self._resume_judge_signature_for_record(record)
        callback_job_context_signature = self._resume_judge_callback_signature(payload)
        callback_input_signature = self._resume_judge_callback_input_signature(payload)
        if (
            callback_job_context_signature
            and callback_job_context_signature != current_job_context_signature
        ):
            return record

        draft = self.draft_repository.fetch_draft(
            user_id=record.user_id,
            application_id=record.id,
        )
        if draft is None:
            return record

        current_input_signature = self._resume_judge_input_signature(record=record, draft=draft)
        if callback_input_signature:
            if callback_input_signature != current_input_signature:
                return record
        elif draft.updated_at != payload.evaluated_draft_updated_at:
            return record

        current_run_attempt_count = self._resume_judge_run_attempt_count(
            record.resume_judge_result,
            input_signature=callback_input_signature or current_input_signature,
            draft_updated_at=payload.evaluated_draft_updated_at,
            job_context_signature=callback_job_context_signature or current_job_context_signature,
        )

        if payload.event == "started":
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": self._resume_judge_status_payload(
                        status="running",
                        message="Resume Judge is running.",
                        evaluated_draft_updated_at=payload.evaluated_draft_updated_at,
                        run_attempt_count=current_run_attempt_count or None,
                        job_context_signature=callback_job_context_signature or current_job_context_signature,
                        input_signature=callback_input_signature or current_input_signature,
                    )
                },
            )

        if payload.event == "failed":
            if payload.failure is None:
                raise ValueError("Missing Resume Judge failure payload.")
            failure_result = payload.failure.result.model_dump()
            failure_result["input_signature"] = callback_input_signature or current_input_signature
            if current_run_attempt_count:
                failure_result["run_attempt_count"] = current_run_attempt_count
            self._record_activity_event(
                user_id=record.user_id,
                application_id=record.id,
                activity_type="resume_judge_failed",
                status="failure",
                failure_message=str(failure_result.get("message") or "Resume Judge failed."),
                details={
                    "failure_stage": failure_result.get("failure_stage"),
                    "attempt_count": failure_result.get("attempt_count"),
                },
                attempts=self._sanitize_attempts_for_activity(failure_result.get("attempts")),
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": failure_result
                },
            )

        if payload.event == "succeeded":
            if payload.result is None:
                raise ValueError("Missing Resume Judge success payload.")
            success_result = payload.result.model_dump()
            success_result["input_signature"] = callback_input_signature or current_input_signature
            if current_run_attempt_count:
                success_result["run_attempt_count"] = current_run_attempt_count
            self._record_activity_event(
                user_id=record.user_id,
                application_id=record.id,
                activity_type="resume_judge_succeeded",
                details={
                    "attempt_count": success_result.get("attempt_count"),
                    "display_score": success_result.get("display_score"),
                    "verdict": success_result.get("verdict"),
                    "score_summary": success_result.get("score_summary"),
                    "evaluator_notes": success_result.get("evaluator_notes"),
                    "regeneration_instructions": success_result.get("regeneration_instructions"),
                },
                attempts=self._sanitize_attempts_for_activity(success_result.get("attempts")),
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": success_result
                },
            )

        raise ValueError("Unsupported Resume Judge callback event.")

    async def handle_keyword_extraction_callback(
        self,
        payload: KeywordExtractionCallbackPayload,
    ) -> ApplicationRecord:
        record = self.repository.fetch_application_unscoped(payload.application_id)
        if record is None:
            raise LookupError("Application not found.")
        if record.user_id != payload.user_id:
            raise PermissionError("Worker payload user mismatch.")

        current_keywords = record.job_keywords if isinstance(record.job_keywords, dict) else {}
        current_job_id = str(current_keywords.get("job_id") or "").strip()
        current_source_hash = str(current_keywords.get("source_hash") or "").strip()
        if current_job_id and current_job_id != payload.job_id:
            return record
        if current_source_hash and current_source_hash != payload.source_hash:
            return record
        if self._keyword_source_hash(record.job_description) != payload.source_hash:
            return record

        if payload.event == "started":
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="running",
                        source_hash=payload.source_hash,
                        preserve_manual_from=record.job_keywords,
                        job_id=payload.job_id,
                    )
                },
            )

        if payload.event == "failed":
            message = payload.failure.message if payload.failure else "Keyword extraction failed."
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="failed",
                        source_hash=payload.source_hash,
                        preserve_manual_from=record.job_keywords,
                        job_id=payload.job_id,
                        message=message,
                    )
                },
            )

        if payload.event == "succeeded":
            keywords = self._filter_keywords_to_job_description(
                payload.keywords or [],
                record.job_description,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="succeeded",
                        source_hash=payload.source_hash,
                        keywords=keywords,
                        preserve_manual_from=record.job_keywords,
                        job_id=payload.job_id,
                        model_used=payload.model_used,
                    )
                },
            )

        raise ValueError("Unsupported keyword extraction callback event.")

    async def get_draft(
        self, *, user_id: str, application_id: str,
    ) -> Optional[ResumeDraftRecord]:
        self._require_application(user_id=user_id, application_id=application_id)
        return self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)

    async def get_draft_with_review_flags(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> tuple[Optional[ResumeDraftRecord], list[DraftReviewFlagPayload], Optional[dict[str, Any]]]:
        record = self._require_application(user_id=user_id, application_id=application_id)
        record = await self._recover_stale_keyword_extraction_if_needed(record)
        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            return None, [], None
        return (
            draft,
            self._build_draft_review_flags(record=record, draft=draft),
            self._build_keyword_match_for_draft(record=record, draft=draft),
        )

    def _build_keyword_match_for_draft(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
    ) -> Optional[dict[str, Any]]:
        return self.build_keyword_match_payload(
            job_keywords=record.job_keywords,
            content_md=draft.content_md,
            aggressiveness=str(draft.generation_params.get("aggressiveness") or "medium"),
        )

    def _keyword_generation_settings(
        self,
        *,
        record: ApplicationRecord,
        aggressiveness: str,
    ) -> dict[str, Any]:
        keywords = self._keyword_texts_from_payload(record.job_keywords)
        target = KEYWORD_COVERAGE_TARGETS.get(
            str(aggressiveness or "medium").strip().lower(),
            KEYWORD_COVERAGE_TARGETS["medium"],
        )
        return {
            "job_keywords": keywords,
            "keyword_coverage_target": target,
        }

    async def update_manual_keywords(
        self,
        *,
        user_id: str,
        application_id: str,
        keywords: list[Any],
    ) -> ApplicationDetailPayload:
        record = self._require_application(user_id=user_id, application_id=application_id)
        manual_keywords = self._normalize_manual_keywords(keywords)
        existing = record.job_keywords if isinstance(record.job_keywords, dict) else None
        status = str((existing or {}).get("status") or KEYWORD_STATUS_EMPTY).strip().lower()
        if status not in {"queued", "running", "succeeded", "failed", KEYWORD_STATUS_EMPTY}:
            status = KEYWORD_STATUS_EMPTY
        source_hash = str((existing or {}).get("source_hash") or self._keyword_source_hash(record.job_description))
        extracted_keywords = self._extracted_keyword_texts_from_payload(existing)
        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates={
                "job_keywords": self._keyword_payload(
                    status=status,
                    source_hash=source_hash,
                    keywords=extracted_keywords,
                    manual_keywords=manual_keywords,
                    preserve_manual_from=existing,
                    extracted_at=str((existing or {}).get("extracted_at") or "").strip() or None,
                    job_id=str((existing or {}).get("job_id") or "").strip() or None,
                    model_used=str((existing or {}).get("model_used") or "").strip() or None,
                    message=str((existing or {}).get("message") or "").strip() or None,
                )
            },
        )
        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="keywords_updated",
            details={"manual_keyword_count": len(manual_keywords)},
        )
        return self._detail_payload(updated)

    async def save_draft_edit(
        self,
        *,
        user_id: str,
        application_id: str,
        content: str,
    ) -> ResumeDraftRecord:
        record = self._require_application(user_id=user_id, application_id=application_id)
        return await self._save_draft_edit_for_record(record=record, content=content)

    async def save_draft_edit_with_keyword_match(
        self,
        *,
        user_id: str,
        application_id: str,
        content: str,
    ) -> tuple[ResumeDraftRecord, Optional[dict[str, Any]]]:
        record = self._require_application(user_id=user_id, application_id=application_id)
        updated_draft = await self._save_draft_edit_for_record(record=record, content=content)
        return updated_draft, self._build_keyword_match_for_draft(record=record, draft=updated_draft)

    def _keyword_optimization_failure_details(
        self,
        *,
        record: ApplicationRecord,
        generated: GenerationSuccessPayload,
    ) -> Optional[dict[str, Any]]:
        optimization = generated.generation_params.get("keyword_optimization")
        if not isinstance(optimization, dict) or not optimization.get("enabled"):
            return None
        starting_match = optimization.get("starting_match") if isinstance(optimization.get("starting_match"), dict) else {}
        raw_preserve_keywords = optimization.get("preserve_keywords")
        if not isinstance(raw_preserve_keywords, list):
            raw_preserve_keywords = starting_match.get("matched_keywords", [])
        if not isinstance(raw_preserve_keywords, list):
            raw_preserve_keywords = []
        preserve_keywords = {
            str(keyword).strip().lower()
            for keyword in raw_preserve_keywords
            if str(keyword).strip()
        }
        try:
            starting_matched_count = int(starting_match.get("matched_count") or 0)
        except Exception:
            starting_matched_count = 0
        candidate_match = self.build_keyword_match_payload(
            job_keywords=record.job_keywords,
            content_md=generated.content_md,
            aggressiveness=str(generated.generation_params.get("aggressiveness") or "medium"),
        )
        raw_candidate_matched_keywords = (candidate_match or {}).get("matched_keywords", [])
        if not isinstance(raw_candidate_matched_keywords, list):
            raw_candidate_matched_keywords = []
        candidate_matched_keywords = {
            str(keyword).strip().lower()
            for keyword in raw_candidate_matched_keywords
            if str(keyword).strip()
        }
        missing_preserved_keywords = sorted(preserve_keywords - candidate_matched_keywords)
        candidate_matched_count = int((candidate_match or {}).get("matched_count") or 0)
        if candidate_matched_count >= starting_matched_count and not missing_preserved_keywords:
            return None
        return {
            "failure_stage": "keyword_optimization",
            "terminal_error_code": "keyword_coverage_regressed",
            "starting_matched_count": starting_matched_count,
            "candidate_matched_count": candidate_matched_count,
            "missing_preserved_keywords": missing_preserved_keywords,
            "starting_percentage": starting_match.get("percentage"),
            "candidate_percentage": (candidate_match or {}).get("percentage"),
        }

    async def _save_draft_edit_for_record(
        self,
        *,
        record: ApplicationRecord,
        content: str,
    ) -> ResumeDraftRecord:
        user_id = record.user_id
        application_id = record.id
        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No draft exists. Generation must happen first.")

        normalized_content = self._normalize_draft_content(content)
        previous_input_signature = self._resume_judge_input_signature(record=record, draft=draft)
        updated_draft = self.draft_repository.update_draft_content(
            application_id=application_id,
            user_id=user_id,
            content_md=normalized_content,
        )
        updated_input_signature = self._resume_judge_input_signature(record=record, draft=updated_draft)

        # If current state indicates export happened, transition back to resume_ready
        # and let derive_visible_status figure out the right visible status.
        has_export = record.exported_at is not None
        # After edit, draft is always changed since export
        draft_changed = True if has_export else False

        application_updates: dict[str, Any] = {}
        if record.internal_state == "resume_ready" or has_export:
            updated_vs = derive_visible_status(
                internal_state="resume_ready",
                failure_reason=None,
                has_successful_export=has_export,
                draft_changed_since_export=draft_changed,
            )
            application_updates.update(
                {
                    "internal_state": "resume_ready",
                    "failure_reason": None,
                    "visible_status": updated_vs,
                }
            )
        if record.resume_judge_result is not None and previous_input_signature != updated_input_signature:
            application_updates["resume_judge_result"] = self._resume_judge_status_payload(
                status="failed",
                message="Resume Judge needs another run because the draft changed.",
                evaluated_draft_updated_at=updated_draft.updated_at,
                scored_at=datetime.now(timezone.utc).isoformat(),
                job_context_signature=self._resume_judge_signature_for_record(record),
                input_signature=updated_input_signature,
                failure_stage="stale_draft",
            )
        if application_updates:
            self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates=application_updates,
            )

        self._record_activity_event(
            user_id=user_id,
            application_id=application_id,
            activity_type="draft_saved",
        )

        return updated_draft

    async def export_pdf(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> tuple[bytes, str]:
        return await self._export_resume(
            user_id=user_id,
            application_id=application_id,
            export_format="pdf",
        )

    async def export_docx(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> tuple[bytes, str]:
        return await self._export_resume(
            user_id=user_id,
            application_id=application_id,
            export_format="docx",
        )

    async def _export_resume(
        self,
        *,
        user_id: str,
        application_id: str,
        export_format: str,
    ) -> tuple[bytes, str]:
        record = self._require_application(user_id=user_id, application_id=application_id)

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No draft exists. Generation must happen first.")

        export_format_normalized = export_format.lower()
        format_label = "PDF" if export_format_normalized == "pdf" else "DOCX"
        generator = generate_pdf if export_format_normalized == "pdf" else generate_docx
        profile = self._require_profile(user_id=user_id, action=f"exporting a {format_label}")
        self._require_profile_name(profile, action=f"exporting a {format_label}")
        personal_info = self._build_personal_info(profile)
        full_name = (self._clean_profile_value(profile.name) or "resume").replace(" ", "_")

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"{full_name}_resume_{timestamp}.{export_format_normalized}"

        try:
            export_bytes = await generator(
                markdown_content=self._normalize_draft_content(draft.content_md),
                personal_info=personal_info,
                page_length=str(draft.generation_params.get("page_length") or "1_page"),
            )
        except asyncio.TimeoutError:
            await self._handle_export_failure(
                record=record,
                message=f"{format_label} export timed out. Please try again.",
                format_label=format_label,
            )
            raise ValueError(f"{format_label} export timed out.")
        except Exception as exc:
            logger.exception("%s export failed for application %s", format_label, application_id)
            await self._handle_export_failure(
                record=record,
                message=f"{format_label} export failed. Please try again.",
                format_label=format_label,
            )
            raise ValueError(f"{format_label} export failed.") from exc

        application_updates: dict[str, Any] = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "internal_state": "resume_ready",
            "failure_reason": None,
            "visible_status": derive_visible_status(
                internal_state="resume_ready",
                failure_reason=None,
                has_successful_export=True,
                draft_changed_since_export=False,
            ),
        }
        if (
            isinstance(record.resume_judge_result, dict)
            and record.resume_judge_result
            and not str(record.resume_judge_result.get("input_signature") or "").strip()
            and not self._resume_judge_result_is_stale(
                record=record,
                draft=draft,
                resume_judge_result=record.resume_judge_result,
            )
        ):
            application_updates["resume_judge_result"] = {
                **record.resume_judge_result,
                "input_signature": self._resume_judge_input_signature(record=record, draft=draft),
            }

        self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=application_updates,
        )
        self.draft_repository.update_exported_at(
            application_id=application_id,
            user_id=user_id,
        )

        self.notification_repository.create_notification(
            user_id=user_id,
            application_id=application_id,
            notification_type="success",
            message=f"{format_label} export completed successfully.",
            action_required=False,
        )
        self._record_usage_event(
            user_id=user_id,
            application_id=application_id,
            event_type="export",
            event_status="success",
            metadata={
                "activity_type": "export_succeeded",
                "details": {"format": format_label},
            },
        )

        return export_bytes, filename

    async def _handle_export_failure(
        self,
        *,
        record: ApplicationRecord,
        message: str,
        format_label: str,
    ) -> None:
        self.repository.update_application(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="resume_ready",
                failure_reason="export_failed",
            ),
        )
        self.notification_repository.create_notification(
            user_id=record.user_id,
            application_id=record.id,
            notification_type="error",
            message=message,
            action_required=True,
        )
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="export",
            event_status="failure",
            metadata={
                "activity_type": "export_failed",
                "failure_message": message,
                "details": {"format": format_label},
            },
        )
        try:
            await self.email_sender.send(
                EmailMessage(
                    to=[self._recipient_email(record)],
                    subject=f"Applix: {format_label} export failed",
                    text=(
                        f"{message}\n\n"
                        f"Open the application: {self._application_url(record.id)}"
                    ),
                )
            )
        except Exception:
            pass

    async def _run_duplicate_resolution_flow(self, record: ApplicationRecord) -> ApplicationRecord:
        if not record.job_title or not record.company:
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="generation_pending",
                    failure_reason=None,
                    duplicate_similarity_score=None,
                    duplicate_match_fields=None,
                    extraction_failure_details=None,
                    duplicate_resolution_status=None
                    if record.duplicate_resolution_status != "dismissed"
                    else "dismissed",
                    duplicate_matched_application_id=None,
                ),
            )

        if record.duplicate_resolution_status == "dismissed":
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="generation_pending",
                    failure_reason=None,
                    extraction_failure_details=None,
                ),
            )

        candidates = self.repository.fetch_duplicate_candidates(
            user_id=record.user_id,
            exclude_application_id=record.id,
        )
        decision = self.duplicate_detector.evaluate(application=record, candidates=candidates)
        if decision is None:
            self.notification_repository.clear_action_required(
                user_id=record.user_id,
                application_id=record.id,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="generation_pending",
                    failure_reason=None,
                    extraction_failure_details=None,
                    duplicate_similarity_score=None,
                    duplicate_match_fields=None,
                    duplicate_resolution_status=None,
                    duplicate_matched_application_id=None,
                ),
            )

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="duplicate_review_required",
                failure_reason=None,
                extraction_failure_details=None,
                duplicate_similarity_score=decision.similarity_score,
                duplicate_match_fields={
                    "matched_fields": decision.matched_fields,
                    "match_basis": decision.match_basis,
                },
                duplicate_resolution_status="pending",
                duplicate_matched_application_id=decision.matched_application_id,
            ),
        )
        await self._set_action_required(
            record=updated,
            notification_type="warning",
            message="Possible duplicate application detected. Review before proceeding.",
            send_email=False,
        )
        return updated

    async def _mark_extraction_failure(
        self,
        *,
        record: ApplicationRecord,
        message: str,
        failure_details: Optional[ExtractionFailureDetailsPayload] = None,
    ) -> ApplicationRecord:
        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="manual_entry_required",
                failure_reason="extraction_failed",
                extraction_failure_details=(
                    failure_details.model_dump() if failure_details is not None else None
                ),
            ),
        )
        await self._set_action_required(
            record=updated,
            notification_type="error",
            message=message,
            send_email=True,
        )
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="extraction",
            event_status="failure",
            metadata={
                "activity_type": "extraction_failed",
                "failure_message": message,
                "details": failure_details.model_dump() if failure_details is not None else None,
            },
        )
        return updated

    async def _mark_generation_failure(
        self,
        *,
        record: ApplicationRecord,
        message: str,
        failure_details: Optional[dict[str, Any]] = None,
        failure_reason: str = "generation_failed",
    ) -> ApplicationRecord:
        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="resume_ready" if record.internal_state in (
                    "regenerating_section", "regenerating_full",
                ) else "generation_pending",
                failure_reason=failure_reason,
                generation_failure_details=self._normalize_generation_failure_details(
                    message=message,
                    failure_details=failure_details,
                ),
            ),
        )
        await self._set_action_required(
            record=updated,
            notification_type="error",
            message=message,
            send_email=True,
            email_subject=f"Applix: {'regeneration' if 'regeneration' in failure_reason else 'generation'} failed",
        )
        normalized_details = self._normalize_generation_failure_details(message=message, failure_details=failure_details)
        activity_type = "regeneration_failed" if "regeneration" in failure_reason else "generation_failed"
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="regeneration" if "regeneration" in failure_reason else "generation",
            event_status="failure",
            metadata={
                "activity_type": activity_type,
                "failure_message": message,
                "details": {
                    key: normalized_details.get(key)
                    for key in (
                        "failure_stage",
                        "attempt_count",
                        "terminal_error_code",
                        "repair_model",
                        "section_name",
                        "length_diagnostics",
                    )
                    if normalized_details.get(key) not in (None, "")
                }
                or None,
                "attempts": self._sanitize_attempts_for_activity(normalized_details.get("attempts")),
            },
        )
        return updated

    async def _send_generation_email(
        self,
        *,
        record: ApplicationRecord,
        subject: str,
        body: str,
    ) -> None:
        try:
            await self.email_sender.send(
                EmailMessage(
                    to=[self._recipient_email(record)],
                    subject=subject,
                    text=(
                        f"{body}\n\n"
                        f"Open the application: {self._application_url(record.id)}"
                    ),
                )
            )
        except Exception:
            pass

    async def _set_action_required(
        self,
        *,
        record: ApplicationRecord,
        notification_type: str,
        message: str,
        send_email: bool,
        email_subject: Optional[str] = None,
    ) -> None:
        self.notification_repository.clear_action_required(
            user_id=record.user_id,
            application_id=record.id,
        )
        self.notification_repository.create_notification(
            user_id=record.user_id,
            application_id=record.id,
            notification_type=notification_type,
            message=message,
            action_required=True,
        )
        if send_email:
            subject = email_subject or "Applix: extraction needs manual entry"
            await self.email_sender.send(
                EmailMessage(
                    to=[self._recipient_email(record)],
                    subject=subject,
                    text=(
                        f"{message}\n\n"
                        f"Open the application: {self._application_url(record.id)}"
                    ),
                )
            )

    async def _route_blocked_job_data_to_manual_entry(
        self,
        record: ApplicationRecord,
    ) -> ApplicationDetailPayload:
        failure_details = self._blocked_source_failure_details(record)
        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="manual_entry_required",
                failure_reason="extraction_failed",
                extraction_failure_details=failure_details,
                generation_failure_details=None,
                duplicate_similarity_score=None,
                duplicate_match_fields=None,
                duplicate_resolution_status=None,
                duplicate_matched_application_id=None,
            ),
        )
        await self._set_action_required(
            record=updated,
            notification_type="error",
            message=(
                "Stored job details look like a blocked-source placeholder. "
                "Paste the job text or complete manual entry."
            ),
            send_email=False,
        )
        return self._detail_payload(updated)

    def _recipient_email(self, record: ApplicationRecord) -> str:
        profile = self.profile_repository.fetch_profile(record.user_id)
        if profile is None:
            raise ValueError("Authenticated profile is unavailable.")
        return profile.email

    @staticmethod
    def _clean_profile_value(value: Any) -> Optional[str]:
        if value is None:
            return None
        stripped = str(value).strip()
        return stripped or None

    def _require_profile(self, *, user_id: str, action: str):
        profile = self.profile_repository.fetch_profile(user_id)
        if profile is None:
            raise ValueError(f"Complete your profile before {action}.")
        return profile

    @staticmethod
    def _profile_is_admin(profile: Any) -> bool:
        return bool(getattr(profile, "is_admin", False))

    def _reserve_generation_quota(self, *, user_id: str) -> QuotaReservationRecord:
        if self.subscription_repository is None:
            raise PermissionError("Subscription configuration is unavailable.")
        return self.subscription_repository.reserve_generation_quota(user_id=user_id)

    def _release_generation_quota(self, *, user_id: str, reservation: QuotaReservationRecord) -> None:
        self._release_generation_quota_for_period(user_id=user_id, period_start=reservation.period_start)

    def _release_generation_quota_for_period(self, *, user_id: str, period_start: Optional[str]) -> None:
        if self.subscription_repository is None:
            return
        if not period_start:
            logger.warning("Skipped generation quota release for user_id=%s because period_start is missing.", user_id)
            return
        try:
            self.subscription_repository.release_generation_quota(
                user_id=user_id,
                period_start=period_start,
            )
        except Exception:
            logger.warning("Failed to release reserved generation quota for user_id=%s.", user_id, exc_info=True)

    @staticmethod
    def _quota_generation_settings(reservation: QuotaReservationRecord) -> dict[str, Any]:
        return {
            "subscription_tier": reservation.subscription_tier,
            "quota_period_start": reservation.period_start,
            "_generation_model": reservation.generation_model,
            "_generation_reasoning_effort": reservation.generation_reasoning_effort,
            "_generation_fallback_model": reservation.generation_fallback_model,
            "_generation_fallback_reasoning_effort": reservation.generation_fallback_reasoning_effort,
        }

    def _require_profile_name(self, profile, *, action: str) -> None:
        if not self._clean_profile_value(getattr(profile, "name", None)):
            raise ValueError(f"Complete your profile name before {action}.")

    def _normalize_draft_content(self, content: str) -> str:
        try:
            return normalize_resume_markdown(content)
        except ValueError as exc:
            raise ValueError(f"Draft content does not match the structured resume layout: {exc}") from exc

    def _build_personal_info(self, profile) -> dict[str, Optional[str]]:
        return {
            "name": self._clean_profile_value(getattr(profile, "name", None)),
            "email": self._clean_profile_value(getattr(profile, "email", None)),
            "phone": self._clean_profile_value(getattr(profile, "phone", None)),
            "address": self._clean_profile_value(getattr(profile, "address", None)),
            "linkedin_url": self._clean_profile_value(getattr(profile, "linkedin_url", None)),
        }

    @staticmethod
    def _looks_like_blocked_source_placeholder(record: ApplicationRecord) -> bool:
        failure_details = record.extraction_failure_details or {}
        if failure_details.get("kind") == "blocked_source":
            return True

        title = (record.job_title or "").strip().lower()
        description = (record.job_description or "").strip().lower()

        if title in BLOCKED_PLACEHOLDER_TITLE_VALUES:
            return True
        if any(title.startswith(prefix) for prefix in BLOCKED_PLACEHOLDER_TITLE_PREFIXES):
            return True
        return any(marker in description for marker in BLOCKED_PLACEHOLDER_DESCRIPTION_MARKERS)

    @staticmethod
    def _blocked_source_failure_details(record: ApplicationRecord) -> dict[str, Any]:
        existing = record.extraction_failure_details or {}
        if existing.get("kind") == "blocked_source":
            return existing
        return {
            "kind": "blocked_source",
            "provider": record.job_posting_origin,
            "reference_id": None,
            "blocked_url": record.job_url,
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _build_section_preferences(profile) -> list[dict[str, Any]]:
        prefs = profile.section_preferences or {}
        order = profile.section_order or DEFAULT_SECTION_ORDER
        result = []
        for idx, section_name in enumerate(order):
            result.append({
                "name": section_name,
                "enabled": prefs.get(section_name, True),
                "order": idx,
            })
        for section_name, enabled in prefs.items():
            if section_name not in order:
                result.append({
                    "name": section_name,
                    "enabled": enabled,
                    "order": len(result),
                })
        return result

    @staticmethod
    def _section_preferences_for_existing_draft(
        *,
        draft: ResumeDraftRecord,
        fallback: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        snapshot = draft.sections_snapshot if isinstance(draft.sections_snapshot, dict) else {}
        raw_order = snapshot.get("section_order") or snapshot.get("enabled_sections") or []
        section_order: list[str] = []
        seen: set[str] = set()
        if isinstance(raw_order, list):
            for item in raw_order:
                section = str(item or "").strip()
                if not section or section in seen:
                    continue
                seen.add(section)
                section_order.append(section)
        if not section_order:
            return fallback
        return [
            {"name": section, "enabled": True, "order": index}
            for index, section in enumerate(section_order)
        ]

    def _detail_payload(self, record: ApplicationRecord) -> ApplicationDetailPayload:
        warning = None
        draft = self.draft_repository.fetch_draft(user_id=record.user_id, application_id=record.id)
        if (
            record.duplicate_resolution_status == "pending"
            and record.duplicate_matched_application_id
            and record.duplicate_similarity_score is not None
            and record.duplicate_match_fields
        ):
            matched = self.repository.fetch_matched_application(
                user_id=record.user_id,
                application_id=record.duplicate_matched_application_id,
            )
            if matched is not None:
                warning = DuplicateWarningPayload(
                    similarity_score=record.duplicate_similarity_score,
                    matched_fields=list(record.duplicate_match_fields.get("matched_fields", [])),
                    match_basis=str(record.duplicate_match_fields.get("match_basis", "")),
                    matched_application=matched,
                )
        return ApplicationDetailPayload(
            application=record,
            duplicate_warning=warning,
            resume_judge_result=self._resume_judge_response_payload(record=record, draft=draft),
        )

    def _stream_detail_payload(self, record: ApplicationRecord) -> dict[str, Any]:
        payload = self._detail_payload(record)
        duplicate_warning = None
        if payload.duplicate_warning is not None:
            duplicate_warning = {
                "similarity_score": payload.duplicate_warning.similarity_score,
                "matched_fields": payload.duplicate_warning.matched_fields,
                "match_basis": payload.duplicate_warning.match_basis,
                "matched_application": payload.duplicate_warning.matched_application.model_dump(mode="json"),
            }

        return {
            **record.model_dump(
                mode="json",
                exclude={
                    "exported_at",
                    "duplicate_match_fields",
                    "full_regeneration_count",
                    "user_id",
                },
            ),
            "resume_judge_result": payload.resume_judge_result,
            "duplicate_warning": duplicate_warning,
        }

    async def _publish_detail_event(self, record: ApplicationRecord) -> None:
        try:
            await self.progress_store.publish_event(
                record.id,
                ApplicationEvent(
                    event="detail",
                    payload=self._stream_detail_payload(record),
                ),
            )
        except Exception:
            logger.warning("Failed publishing detail event for application %s", record.id, exc_info=True)

    async def _update_application_and_publish_detail(
        self,
        *,
        application_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> ApplicationRecord:
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=updates,
        )
        await self._publish_detail_event(updated)
        return updated

    @staticmethod
    def _resume_judge_status_payload(
        *,
        status: str,
        message: str,
        evaluated_draft_updated_at: str,
        scored_at: Optional[str] = None,
        **extra_fields: Any,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": status,
            "message": message,
            "evaluated_draft_updated_at": evaluated_draft_updated_at,
        }
        if scored_at:
            payload["scored_at"] = scored_at
        for key, value in extra_fields.items():
            if value is not None:
                payload[key] = value
        return payload

    @classmethod
    def _resume_judge_run_attempt_count(
        cls,
        resume_judge_result: Optional[dict[str, Any]],
        *,
        input_signature: Optional[str] = None,
        draft_updated_at: str,
        job_context_signature: str,
    ) -> int:
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return 0
        stored_input_signature = str(resume_judge_result.get("input_signature") or "").strip()
        if input_signature:
            if stored_input_signature:
                if stored_input_signature != input_signature:
                    return 0
            elif not cls._legacy_resume_judge_result_matches_current(
                resume_judge_result,
                draft_updated_at=draft_updated_at,
            ):
                return 0
        elif str(resume_judge_result.get("evaluated_draft_updated_at") or "") != draft_updated_at:
            return 0
        stored_job_context_signature = str(resume_judge_result.get("job_context_signature") or "")
        if stored_job_context_signature and stored_job_context_signature != job_context_signature:
            return 0
        stored_count = resume_judge_result.get("run_attempt_count")
        if isinstance(stored_count, int):
            return max(stored_count, 0)
        status = str(resume_judge_result.get("status") or "").strip().lower()
        if status in {"queued", "running", "succeeded", "failed"}:
            return 1
        return 0

    @staticmethod
    def _normalize_resume_judge_context_value(value: Optional[str]) -> str:
        collapsed = re.sub(r"\s+", " ", str(value or ""))
        return collapsed.strip().lower()

    @classmethod
    def _resume_judge_job_context_signature(
        cls,
        *,
        job_title: Optional[str],
        company_name: Optional[str],
        job_description: Optional[str],
    ) -> str:
        return "\x1f".join(
            [
                cls._normalize_resume_judge_context_value(job_title),
                cls._normalize_resume_judge_context_value(company_name),
                cls._normalize_resume_judge_context_value(job_description),
            ]
        )

    @classmethod
    def _resume_judge_signature_for_record(cls, record: ApplicationRecord) -> str:
        return cls._resume_judge_job_context_signature(
            job_title=record.job_title,
            company_name=record.company,
            job_description=record.job_description,
        )

    @classmethod
    def _resume_judge_job_context_changed(
        cls,
        *,
        record: ApplicationRecord,
        updates: dict[str, Any],
    ) -> bool:
        return cls._resume_judge_signature_for_record(record) != cls._resume_judge_job_context_signature(
            job_title=updates.get("job_title", record.job_title),
            company_name=updates.get("company", record.company),
            job_description=updates.get("job_description", record.job_description),
        )

    @classmethod
    def _resume_judge_callback_signature(
        cls,
        payload: ResumeJudgeCallbackPayload,
    ) -> Optional[str]:
        if payload.job_context_signature:
            return payload.job_context_signature
        if payload.result and payload.result.job_context_signature:
            return payload.result.job_context_signature
        if payload.failure and payload.failure.result.job_context_signature:
            return payload.failure.result.job_context_signature
        return None

    @staticmethod
    def _resume_judge_callback_input_signature(
        payload: ResumeJudgeCallbackPayload,
    ) -> Optional[str]:
        if payload.input_signature:
            return payload.input_signature
        if payload.result and payload.result.input_signature:
            return payload.result.input_signature
        if payload.failure and payload.failure.result.input_signature:
            return payload.failure.result.input_signature
        return None

    @staticmethod
    def _normalize_resume_judge_signature_text(value: str) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    @classmethod
    def _normalize_resume_judge_draft_markdown(cls, content_md: str) -> str:
        try:
            return normalize_resume_markdown(content_md)
        except ValueError:
            return cls._normalize_resume_judge_signature_text(content_md)

    def _resolve_resume_judge_base_resume_content(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
    ) -> Optional[str]:
        base_resume_snapshot_content = draft.generation_params.get("_base_resume_snapshot_content")
        if (
            isinstance(base_resume_snapshot_content, str)
            and base_resume_snapshot_content.strip()
        ):
            return base_resume_snapshot_content

        base_resume_id = str(
            draft.generation_params.get("base_resume_id") or record.base_resume_id or ""
        ).strip()
        if not base_resume_id:
            return None

        base_resume = self.base_resume_repository.fetch_resume(record.user_id, base_resume_id)
        if base_resume is None:
            return None
        return base_resume.content_md

    def _resume_judge_input_signature(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
        content_md: Optional[str] = None,
        job_title: Optional[str] = None,
        company_name: Optional[str] = None,
        job_description: Optional[str] = None,
    ) -> str:
        base_resume_content = self._resolve_resume_judge_base_resume_content(record=record, draft=draft) or ""
        payload = {
            "draft_markdown": self._normalize_resume_judge_draft_markdown(content_md or draft.content_md),
            "job_title": self._normalize_resume_judge_context_value(job_title or record.job_title),
            "company_name": self._normalize_resume_judge_context_value(company_name or record.company),
            "job_description": self._normalize_resume_judge_context_value(job_description or record.job_description),
            "page_length": str(draft.generation_params.get("page_length") or "1_page").strip().lower(),
            "aggressiveness": str(draft.generation_params.get("aggressiveness") or "medium").strip().lower(),
            "base_resume_fingerprint": hashlib.sha256(base_resume_content.encode("utf-8")).hexdigest(),
        }
        canonical_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _legacy_resume_judge_result_matches_current(
        resume_judge_result: Optional[dict[str, Any]],
        *,
        draft_updated_at: str,
    ) -> bool:
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return False
        evaluated_draft_updated_at = str(resume_judge_result.get("evaluated_draft_updated_at") or "")
        if evaluated_draft_updated_at == draft_updated_at:
            return True
        return False

    def _resume_judge_result_is_stale(
        self,
        *,
        record: ApplicationRecord,
        draft: Optional[ResumeDraftRecord],
        resume_judge_result: Optional[dict[str, Any]],
    ) -> bool:
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return False
        current_job_signature = self._resume_judge_signature_for_record(record)
        stored_job_signature = str(resume_judge_result.get("job_context_signature") or "")
        if stored_job_signature and stored_job_signature != current_job_signature:
            return True
        if draft is None:
            return False
        stored_input_signature = str(resume_judge_result.get("input_signature") or "").strip()
        if stored_input_signature:
            return stored_input_signature != self._resume_judge_input_signature(record=record, draft=draft)
        return not self._legacy_resume_judge_result_matches_current(
            resume_judge_result,
            draft_updated_at=draft.updated_at,
        )

    def _resume_judge_response_payload(
        self,
        *,
        record: ApplicationRecord,
        draft: Optional[ResumeDraftRecord],
    ) -> Optional[dict[str, Any]]:
        if not isinstance(record.resume_judge_result, dict) or not record.resume_judge_result:
            return None
        result = dict(record.resume_judge_result)
        result["is_stale"] = self._resume_judge_result_is_stale(
            record=record,
            draft=draft,
            resume_judge_result=record.resume_judge_result,
        )
        return result

    @staticmethod
    def _should_enqueue_resume_judge(
        resume_judge_result: Optional[dict[str, Any]],
        *,
        input_signature: Optional[str] = None,
        draft_updated_at: str,
        force: bool = False,
    ) -> bool:
        if force:
            return True
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return True
        stored_input_signature = str(resume_judge_result.get("input_signature") or "").strip()
        if input_signature:
            if stored_input_signature:
                return stored_input_signature != input_signature
            return str(resume_judge_result.get("evaluated_draft_updated_at") or "") != draft_updated_at
        return str(resume_judge_result.get("evaluated_draft_updated_at") or "") != draft_updated_at

    async def _enqueue_resume_judge_for_draft(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
        force: bool = False,
        application_updates: Optional[dict[str, Any]] = None,
    ) -> ApplicationRecord:
        current_job_context_signature = self._resume_judge_signature_for_record(record)
        input_signature = self._resume_judge_input_signature(record=record, draft=draft)
        if not self._should_enqueue_resume_judge(
            record.resume_judge_result,
            input_signature=input_signature,
            draft_updated_at=draft.updated_at,
            force=force,
        ):
            return record

        current_run_attempt_count = self._resume_judge_run_attempt_count(
            record.resume_judge_result,
            input_signature=input_signature,
            draft_updated_at=draft.updated_at,
            job_context_signature=current_job_context_signature,
        )
        if force and current_run_attempt_count >= RESUME_JUDGE_RUN_LIMIT_PER_DRAFT:
            raise PermissionError(
                "Resume Judge has already reached the maximum of 3 attempts for this draft. "
                "Regenerate or edit the draft before trying again."
            )
        base_resume_snapshot_content = draft.generation_params.get("_base_resume_snapshot_content")
        if (
            isinstance(base_resume_snapshot_content, str)
            and base_resume_snapshot_content.strip()
        ):
            base_resume_content = base_resume_snapshot_content
        else:
            base_resume_content = ""
        if not base_resume_content:
            base_resume_id = str(
                draft.generation_params.get("base_resume_id") or record.base_resume_id or ""
            ).strip()
            if not base_resume_id:
                queued_updates = dict(application_updates or {})
                queued_updates["resume_judge_result"] = self._resume_judge_status_payload(
                    status="failed",
                    message="Resume Judge could not run because the source base resume is unavailable.",
                    evaluated_draft_updated_at=draft.updated_at,
                    scored_at=datetime.now(timezone.utc).isoformat(),
                    job_context_signature=current_job_context_signature,
                    failure_stage="precondition",
                )
                return await self._update_application_and_publish_detail(
                    application_id=record.id,
                    user_id=record.user_id,
                    updates=queued_updates,
                )

            base_resume = self.base_resume_repository.fetch_resume(record.user_id, base_resume_id)
            if base_resume is None:
                queued_updates = dict(application_updates or {})
                queued_updates["resume_judge_result"] = self._resume_judge_status_payload(
                    status="failed",
                    message="Resume Judge could not run because the linked base resume was not found.",
                    evaluated_draft_updated_at=draft.updated_at,
                    scored_at=datetime.now(timezone.utc).isoformat(),
                    job_context_signature=current_job_context_signature,
                    failure_stage="precondition",
                )
                return await self._update_application_and_publish_detail(
                    application_id=record.id,
                    user_id=record.user_id,
                    updates=queued_updates,
                )
            base_resume_content = base_resume.content_md

        if not record.job_title or not record.job_description:
            queued_updates = dict(application_updates or {})
            queued_updates["resume_judge_result"] = self._resume_judge_status_payload(
                status="failed",
                message="Resume Judge could not run because the application is missing job details.",
                evaluated_draft_updated_at=draft.updated_at,
                scored_at=datetime.now(timezone.utc).isoformat(),
                job_context_signature=current_job_context_signature,
                failure_stage="precondition",
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=queued_updates,
            )

        queued_updates = dict(application_updates or {})
        queued_updates["resume_judge_result"] = self._resume_judge_status_payload(
            status="queued",
            message="Resume Judge is queued.",
            evaluated_draft_updated_at=draft.updated_at,
            run_attempt_count=current_run_attempt_count + 1,
            job_context_signature=current_job_context_signature,
            input_signature=input_signature,
        )
        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=queued_updates,
        )
        self._record_activity_event(
            user_id=record.user_id,
            application_id=record.id,
            activity_type="resume_judge_queued",
            details={"run_attempt_count": current_run_attempt_count + 1},
        )

        try:
            await self.generation_job_queue.enqueue_resume_judge(
                application_id=record.id,
                user_id=record.user_id,
                job_title=record.job_title,
                company_name=record.company,
                job_description=record.job_description,
                base_resume_content=base_resume_content,
                generated_resume_content=draft.content_md,
                generation_settings={
                    "page_length": str(draft.generation_params.get("page_length") or "1_page"),
                    "aggressiveness": str(draft.generation_params.get("aggressiveness") or "medium"),
                },
                evaluated_draft_updated_at=draft.updated_at,
                job_context_signature=current_job_context_signature,
                input_signature=input_signature,
            )
            return updated
        except Exception as error:
            failed_updates = dict(application_updates or {})
            failed_updates["resume_judge_result"] = self._resume_judge_status_payload(
                status="failed",
                message="Resume Judge could not be started. Score unavailable.",
                evaluated_draft_updated_at=draft.updated_at,
                scored_at=datetime.now(timezone.utc).isoformat(),
                job_context_signature=current_job_context_signature,
                input_signature=input_signature,
                failure_stage="enqueue",
                error={
                    "error_type": type(error).__name__,
                    "message": str(error),
                },
            )
            self._record_activity_event(
                user_id=record.user_id,
                application_id=record.id,
                activity_type="resume_judge_failed",
                status="failure",
                failure_message="Resume Judge could not be started. Score unavailable.",
                details={
                    "failure_stage": "enqueue",
                    "error_type": type(error).__name__,
                },
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=failed_updates,
            )

    @staticmethod
    def _normalize_search_text(value: str) -> str:
        lowered = str(value or "").lower()
        lowered = re.sub(r"[^a-z0-9+#/ -]+", " ", lowered)
        return re.sub(r"\s+", " ", lowered).strip()

    @staticmethod
    def _keyword_source_hash(job_description: Optional[str]) -> str:
        # Keep in sync with keyword_source_hash in the worker process.
        normalized = re.sub(r"\s+", " ", str(job_description or "")).strip().lower()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_keyword_text(value: Any) -> Optional[str]:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        return text or None

    @classmethod
    def _normalize_keyword_source(cls, value: Any) -> str:
        source = str(value or "extracted").strip().lower()
        return "manual" if source == "manual" else "extracted"

    @classmethod
    def _keyword_entries_from_payload(cls, job_keywords: Optional[dict[str, Any]]) -> list[dict[str, str]]:
        if not isinstance(job_keywords, dict):
            return []
        raw_keywords = job_keywords.get("keywords")
        if not isinstance(raw_keywords, list):
            return []
        entries: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in raw_keywords:
            raw_text = item.get("text") if isinstance(item, dict) else item
            text = cls._normalize_keyword_text(raw_text)
            if not text:
                continue
            dedupe_key = text.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            entry = {
                "text": text,
                "source": cls._normalize_keyword_source(item.get("source") if isinstance(item, dict) else None),
            }
            if isinstance(item, dict):
                added_at = str(item.get("added_at") or "").strip()
                if added_at:
                    entry["added_at"] = added_at
            entries.append(entry)
        return entries

    @classmethod
    def _keyword_texts_from_payload(cls, job_keywords: Optional[dict[str, Any]]) -> list[str]:
        return [entry["text"] for entry in cls._keyword_entries_from_payload(job_keywords)]

    @classmethod
    def _manual_keyword_texts_from_payload(cls, job_keywords: Optional[dict[str, Any]]) -> list[str]:
        return [
            entry["text"]
            for entry in cls._keyword_entries_from_payload(job_keywords)
            if entry.get("source") == "manual"
        ]

    @classmethod
    def _extracted_keyword_texts_from_payload(cls, job_keywords: Optional[dict[str, Any]]) -> list[str]:
        return [
            entry["text"]
            for entry in cls._keyword_entries_from_payload(job_keywords)
            if entry.get("source") != "manual"
        ]

    @classmethod
    def _keyword_payload_entries(
        cls,
        *,
        extracted_keywords: Optional[list[Any]] = None,
        manual_keywords: Optional[list[Any]] = None,
        manual_added_at: Optional[dict[str, str]] = None,
    ) -> list[dict[str, str]]:
        entries: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in extracted_keywords or []:
            text = cls._normalize_keyword_text(item)
            if not text:
                continue
            dedupe_key = text.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            entries.append({"text": text, "source": "extracted"})
        now = datetime.now(timezone.utc).isoformat()
        added_lookup = manual_added_at or {}
        for item in manual_keywords or []:
            text = cls._normalize_keyword_text(item)
            if not text:
                continue
            dedupe_key = text.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            entries.append({
                "text": text,
                "source": "manual",
                "added_at": added_lookup.get(dedupe_key) or now,
            })
        return entries

    @classmethod
    def _manual_keyword_added_at_lookup(cls, job_keywords: Optional[dict[str, Any]]) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for entry in cls._keyword_entries_from_payload(job_keywords):
            if entry.get("source") != "manual":
                continue
            added_at = str(entry.get("added_at") or "").strip()
            if added_at:
                lookup[entry["text"].lower()] = added_at
        return lookup

    @classmethod
    def _normalize_manual_keywords(cls, keywords: list[Any]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in keywords:
            text = cls._normalize_keyword_text(item)
            if not text:
                raise ValueError("Manual keywords cannot be blank.")
            if len(text) > KEYWORD_TEXT_MAX_CHARS:
                raise ValueError(f"Manual keywords must be {KEYWORD_TEXT_MAX_CHARS} characters or fewer.")
            dedupe_key = text.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            normalized.append(text)
            if len(normalized) > KEYWORD_MANUAL_MAX_COUNT:
                raise ValueError(f"Manual keywords are limited to {KEYWORD_MANUAL_MAX_COUNT}.")
        return normalized

    @classmethod
    def _keyword_payload(
        cls,
        *,
        status: str,
        source_hash: str,
        keywords: Optional[list[str]] = None,
        manual_keywords: Optional[list[str]] = None,
        preserve_manual_from: Optional[dict[str, Any]] = None,
        extracted_at: Optional[str] = None,
        job_id: Optional[str] = None,
        model_used: Optional[str] = None,
        message: Optional[str] = None,
    ) -> dict[str, Any]:
        if manual_keywords is None:
            manual_keywords = cls._manual_keyword_texts_from_payload(preserve_manual_from)
        payload: dict[str, Any] = {
            "status": status,
            "source_hash": source_hash,
            "keywords": cls._keyword_payload_entries(
                extracted_keywords=keywords or [],
                manual_keywords=manual_keywords,
                manual_added_at=cls._manual_keyword_added_at_lookup(preserve_manual_from),
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if status == "succeeded":
            payload["extracted_at"] = extracted_at or payload["updated_at"]
        if job_id:
            payload["job_id"] = job_id
        if model_used:
            payload["model_used"] = model_used
        if message:
            payload["message"] = message[:240]
        return payload

    @classmethod
    def _coerce_worker_keyword_payload(
        cls,
        *,
        job_keywords: Optional[dict[str, Any]],
        job_description: Optional[str],
    ) -> Optional[dict[str, Any]]:
        if not isinstance(job_keywords, dict):
            return None
        source_hash = str(job_keywords.get("source_hash") or cls._keyword_source_hash(job_description))
        status = str(job_keywords.get("status") or "succeeded").strip().lower()
        if status not in {"queued", "running", "succeeded", "failed", KEYWORD_STATUS_EMPTY}:
            status = "succeeded"
        keywords = cls._extracted_keyword_texts_from_payload(job_keywords)
        return cls._keyword_payload(
            status=status,
            source_hash=source_hash,
            keywords=cls._filter_keywords_to_job_description(keywords, job_description),
            preserve_manual_from=job_keywords,
            job_id=str(job_keywords.get("job_id") or "").strip() or None,
            model_used=str(job_keywords.get("model_used") or "").strip() or None,
            message=str(job_keywords.get("message") or "").strip() or None,
        )

    @staticmethod
    @lru_cache(maxsize=512)
    def _keyword_regex(keyword: str) -> re.Pattern[str]:
        # Process-local cache sized for several active application keyword sets.
        normalized = re.sub(r"\s+", " ", keyword).strip().lower()
        escaped = re.escape(normalized)
        escaped = escaped.replace(r"\ ", r"\s+")
        prefix = r"(?<![a-z0-9])" if normalized else ""
        suffix = r"(?![a-z0-9])" if normalized else ""
        return re.compile(f"{prefix}{escaped}{suffix}", re.I)

    @classmethod
    def _filter_keywords_to_job_description(
        cls,
        keywords: list[Any],
        job_description: Optional[str],
    ) -> list[str]:
        # Keep exact-phrase boundary behavior in sync with filter_keywords_to_job_description in the worker.
        searchable = re.sub(r"\s+", " ", str(job_description or "")).strip().lower()
        if not searchable:
            return []
        filtered: list[str] = []
        seen: set[str] = set()
        for item in keywords:
            text = cls._normalize_keyword_text(item)
            if not text:
                continue
            dedupe_key = text.lower()
            if dedupe_key in seen:
                continue
            if not cls._keyword_regex(text).search(searchable):
                continue
            seen.add(dedupe_key)
            filtered.append(text)
            if len(filtered) >= 30:
                break
        return filtered

    @classmethod
    def build_keyword_match_payload(
        cls,
        *,
        job_keywords: Optional[dict[str, Any]],
        content_md: str,
        aggressiveness: str,
    ) -> Optional[dict[str, Any]]:
        keywords = cls._keyword_texts_from_payload(job_keywords)
        if not keywords:
            return None
        searchable = re.sub(r"\s+", " ", str(content_md or "")).strip().lower()
        matched: list[str] = []
        missing: list[str] = []
        for keyword in keywords:
            if cls._keyword_regex(keyword).search(searchable):
                matched.append(keyword)
            else:
                missing.append(keyword)
        total = len(keywords)
        matched_count = len(matched)
        percentage = round((matched_count / total) * 100, 1) if total else 0.0
        target_percentage = KEYWORD_COVERAGE_TARGETS.get(
            str(aggressiveness or "medium").strip().lower(),
            KEYWORD_COVERAGE_TARGETS["medium"],
        )
        return {
            "matched_count": matched_count,
            "total_count": total,
            "percentage": percentage,
            "target_percentage": target_percentage,
            "target_met": percentage >= target_percentage,
            "matched_keywords": matched,
            "missing_keywords": missing,
        }

    async def _enqueue_keyword_extraction_for_record(
        self,
        record: ApplicationRecord,
        *,
        force: bool = False,
    ) -> ApplicationRecord:
        job_description = record.job_description or ""
        if not job_description.strip():
            manual_keywords = self._manual_keyword_texts_from_payload(record.job_keywords)
            if record.job_keywords is None and not manual_keywords:
                return record
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": (
                        self._keyword_payload(
                            status=KEYWORD_STATUS_EMPTY,
                            source_hash=self._keyword_source_hash(job_description),
                            manual_keywords=manual_keywords,
                            preserve_manual_from=record.job_keywords,
                            message="Job description is required for extracted keywords.",
                        )
                        if manual_keywords
                        else None
                    )
                },
            )

        source_hash = self._keyword_source_hash(job_description)
        existing = record.job_keywords if isinstance(record.job_keywords, dict) else None
        if (
            not force
            and existing is not None
            and existing.get("source_hash") == source_hash
            and existing.get("status") in {"queued", "running", "succeeded"}
        ):
            return record

        if self.keyword_extraction_job_queue is None:
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="failed",
                        source_hash=source_hash,
                        preserve_manual_from=record.job_keywords,
                        message="Keyword extraction is not configured.",
                    )
                },
            )

        try:
            job_id = await self.keyword_extraction_job_queue.enqueue(
                application_id=record.id,
                user_id=record.user_id,
                job_description=job_description,
                source_hash=source_hash,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="queued",
                        source_hash=source_hash,
                        preserve_manual_from=record.job_keywords,
                        job_id=job_id,
                    )
                },
            )
        except Exception as error:
            logger.warning(
                "keyword_extraction_enqueue_failed app_id=%s error_type=%s",
                record.id,
                type(error).__name__,
            )
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "job_keywords": self._keyword_payload(
                        status="failed",
                        source_hash=source_hash,
                        preserve_manual_from=record.job_keywords,
                        message="Keyword extraction could not be started.",
                    )
                },
            )

    @staticmethod
    def _extract_job_keyword_tokens(job_description: str) -> set[str]:
        tokens = {
            token.lower()
            for token in JOB_KEYWORD_TOKEN_RE.findall(job_description.lower())
            if len(token) >= 3 and token.lower() not in JD_STOPWORDS
        }
        return tokens

    @staticmethod
    def _line_candidates_by_section(content_md: str) -> list[tuple[str, str]]:
        section_name = ""
        rows: list[tuple[str, str]] = []
        for line in content_md.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("## "):
                section_name = stripped[3:].strip().lower().replace(" ", "_")
                continue
            if section_name not in {"summary", "professional_experience", "skills"}:
                continue
            if section_name == "professional_experience":
                if stripped.startswith(("-", "*", "+")):
                    rows.append((section_name, stripped))
                    continue
                if "|" in stripped and EXPERIENCE_HEADER_DATE_RE.search(stripped):
                    rows.append((section_name, stripped))
                continue
            rows.append((section_name, stripped))
        return rows

    def _build_job_description_addition_flags(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
    ) -> list[DraftReviewFlagPayload]:
        aggressiveness = str(draft.generation_params.get("aggressiveness") or "medium").lower()
        if aggressiveness not in {"medium", "high"}:
            return []

        base_resume_id = str(draft.generation_params.get("base_resume_id") or record.base_resume_id or "").strip()
        if not base_resume_id:
            return []
        base_resume = self.base_resume_repository.fetch_resume(record.user_id, base_resume_id)
        if base_resume is None:
            return []

        sanitized_base = sanitize_resume_markdown(base_resume.content_md).sanitized_markdown
        sanitized_draft = sanitize_resume_markdown(draft.content_md).sanitized_markdown
        searchable_base = self._normalize_search_text(sanitized_base)
        job_tokens = self._extract_job_keyword_tokens(record.job_description or "")
        if not searchable_base or not job_tokens:
            return []

        flags: list[DraftReviewFlagPayload] = []
        seen: set[tuple[str, str]] = set()
        for section_name, line in self._line_candidates_by_section(sanitized_draft):
            normalized_line = self._normalize_search_text(line)
            if not normalized_line:
                continue
            if normalized_line in searchable_base:
                continue
            line_tokens = {
                token.lower()
                for token in JOB_KEYWORD_TOKEN_RE.findall(normalized_line)
                if len(token) >= 3 and token.lower() not in JD_STOPWORDS
            }
            if not (line_tokens & job_tokens):
                continue
            dedupe_key = (section_name, normalized_line)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            flags.append(DraftReviewFlagPayload(section_name=section_name, text=line))
            if len(flags) >= 20:
                break
        return flags

    @staticmethod
    def _length_diagnostics_for_activity(diagnostics: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if not isinstance(diagnostics, dict):
            return None
        keys = (
            "target_length",
            "target_label",
            "target_min",
            "target_max",
            "hard_cap",
            "generated_word_count",
            "source_word_count",
            "minimum_acceptable_words",
            "source_aware_minimum",
            "source_limited_allowed",
            "source_limited_length",
            "underfilled",
            "outside_target_range",
            "above_hard_cap",
        )
        sanitized = {key: diagnostics[key] for key in keys if key in diagnostics}
        return sanitized or None

    def _build_source_limited_length_flags(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
    ) -> list[DraftReviewFlagPayload]:
        target_length = str(draft.generation_params.get("page_length") or "1_page")
        base_resume_content = self._resolve_resume_judge_base_resume_content(record=record, draft=draft)
        if not base_resume_content:
            return []

        sanitized_base = sanitize_resume_markdown(base_resume_content).sanitized_markdown
        sanitized_draft = sanitize_resume_markdown(draft.content_md).sanitized_markdown
        assessment = assess_resume_length(
            generated_text=sanitized_draft,
            source_text=sanitized_base,
            target_length=target_length,
        )
        if not assessment["source_limited_length"]:
            return []

        metadata = self._length_diagnostics_for_activity(assessment)
        return [
            DraftReviewFlagPayload(
                section_name="length",
                reason="source_limited_length",
                text=(
                    f"This resume is {assessment['generated_word_count']} words, below the selected "
                    f"{assessment['target_label']} target of {assessment['target_min']}-"
                    f"{assessment['target_max']} words. The source resume has "
                    f"{assessment['source_word_count']} words, so the minimum acceptable source-aware "
                    f"length was {assessment['minimum_acceptable_words']} words without padding."
                ),
                metadata=metadata,
            )
        ]

    def _build_draft_review_flags(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
    ) -> list[DraftReviewFlagPayload]:
        return [
            *self._build_source_limited_length_flags(record=record, draft=draft),
            *self._build_job_description_addition_flags(record=record, draft=draft),
        ]

    def _workflow_updates(
        self,
        *,
        internal_state: str,
        failure_reason: Optional[str],
        **extra_updates: Any,
    ) -> dict[str, Any]:
        return {
            "internal_state": internal_state,
            "failure_reason": failure_reason,
            "visible_status": derive_visible_status(
                internal_state=internal_state,
                failure_reason=failure_reason,
            ),
            **extra_updates,
        }

    def _default_progress_message(self, record: ApplicationRecord) -> str:
        if record.failure_reason == "generation_timeout":
            return "Generation timed out. You can retry."
        if record.failure_reason == "generation_cancelled":
            return "Generation was cancelled."
        if record.failure_reason == "generation_failed":
            return "Generation failed. Review the errors and retry."
        if record.failure_reason == "regeneration_failed":
            return "Regeneration failed. Review the errors and retry."
        if record.internal_state == "manual_entry_required":
            if record.extraction_failure_details and record.extraction_failure_details.get("kind") == "user_cancelled":
                return "Extraction was stopped. Retry or delete this application."
            if record.extraction_failure_details and record.extraction_failure_details.get("kind") == "blocked_source":
                return "This source blocked automated retrieval. Paste the job text or complete manual entry."
            return "Extraction failed. Manual entry is required."
        if record.internal_state == "duplicate_review_required":
            return "Duplicate review is required before generation."
        if record.internal_state == "generation_pending":
            return "Ready for resume generation."
        if record.internal_state == "generating":
            return "Resume generation is running."
        if record.internal_state == "resume_ready":
            return "Resume is ready for review."
        if record.internal_state == "regenerating_section":
            return "Section regeneration is running."
        if record.internal_state == "regenerating_full":
            return "Full regeneration is running."
        if record.internal_state == "extracting":
            return "Extraction is running."
        return "Extraction is queued."

    def _normalize_generation_failure_details(
        self,
        *,
        message: str,
        failure_details: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        normalized: dict[str, Any] = {"message": message}
        if not failure_details:
            return normalized

        for key in (
            "failure_stage",
            "attempt_count",
            "terminal_error_code",
            "repair_model",
            "section_name",
            "starting_matched_count",
            "candidate_matched_count",
            "starting_percentage",
            "candidate_percentage",
        ):
            value = failure_details.get(key)
            if value not in (None, ""):
                normalized[key] = value

        length_diagnostics = self._length_diagnostics_for_activity(failure_details.get("length_diagnostics"))
        if length_diagnostics:
            normalized["length_diagnostics"] = length_diagnostics

        missing_preserved_keywords = failure_details.get("missing_preserved_keywords")
        if isinstance(missing_preserved_keywords, list):
            normalized_keywords = [
                str(keyword).strip()[:KEYWORD_TEXT_MAX_CHARS]
                for keyword in missing_preserved_keywords
                if str(keyword).strip()
            ]
            if normalized_keywords:
                normalized["missing_preserved_keywords"] = normalized_keywords[:KEYWORD_MANUAL_MAX_COUNT]

        attempts = failure_details.get("attempts")
        if isinstance(attempts, list):
            sanitized_attempts: list[dict[str, Any]] = []
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    continue
                sanitized_attempt: dict[str, Any] = {}
                for key in ("model", "reasoning_effort", "transport_mode", "outcome", "elapsed_ms", "retry_reason"):
                    value = attempt.get(key)
                    if value not in (None, ""):
                        sanitized_attempt[key] = value
                if sanitized_attempt:
                    sanitized_attempts.append(sanitized_attempt)
            if sanitized_attempts:
                normalized["attempts"] = sanitized_attempts

        error_details = failure_details.get("error")
        if isinstance(error_details, dict):
            sanitized_error = {
                key: value
                for key, value in error_details.items()
                if key in {"error_type", "message"} and value not in (None, "")
            }
            if sanitized_error:
                normalized["error"] = sanitized_error

        repair_error = failure_details.get("repair_error")
        if isinstance(repair_error, dict):
            sanitized_repair_error = {
                key: value
                for key, value in repair_error.items()
                if key in {"error_type", "message"} and value not in (None, "")
            }
            if sanitized_repair_error:
                normalized["repair_error"] = sanitized_repair_error

        validation_errors = failure_details.get("validation_errors")
        if isinstance(validation_errors, list):
            formatted_errors = [
                formatted
                for formatted in (self._format_validation_error(error) for error in validation_errors)
                if formatted
            ]
            if formatted_errors:
                normalized["validation_errors"] = formatted_errors

        return normalized

    @staticmethod
    def _format_validation_error(error: Any) -> Optional[str]:
        if isinstance(error, str):
            stripped = error.strip()
            return stripped or None

        if isinstance(error, dict):
            detail = str(error.get("detail") or error.get("type") or "").strip()
            section = str(error.get("section") or "").strip()
            if not detail:
                return None
            return f"{section}: {detail}" if section else detail

        text = str(error).strip()
        return text or None

    @staticmethod
    def _generation_workflow_kind(
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> str:
        if progress is not None:
            return progress.workflow_kind
        if record.internal_state == "regenerating_full":
            return "regeneration_full"
        if record.internal_state == "regenerating_section":
            return "regeneration_section"
        return "generation"

    def _target_state_after_generation_stop(
        self,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> str:
        workflow_kind = self._generation_workflow_kind(record, progress)
        return "generation_pending" if workflow_kind == "generation" else "resume_ready"

    def _generation_timeout_seconds(
        self,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> tuple[int, int]:
        workflow_kind = self._generation_workflow_kind(record, progress)
        if workflow_kind == "regeneration_section":
            return (
                SECTION_REGENERATION_IDLE_TIMEOUT_SECONDS,
                SECTION_REGENERATION_MAX_TIMEOUT_SECONDS,
            )
        return (
            FULL_GENERATION_IDLE_TIMEOUT_SECONDS,
            FULL_GENERATION_MAX_TIMEOUT_SECONDS,
        )

    @staticmethod
    def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None

        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    async def _recover_stuck_generation_if_needed(
        self,
        record: ApplicationRecord,
    ) -> ApplicationRecord:
        current_progress = await self.progress_store.get(record.id)
        reconciled = await self._reconcile_terminal_generation_progress(record, current_progress)
        if reconciled is not record:
            return reconciled

        recovered = await self._detect_and_recover_stuck_generation(record)
        if not recovered:
            return record
        return self._refresh(user_id=record.user_id, application_id=record.id)

    async def _recover_stale_keyword_extraction_if_needed(
        self,
        record: ApplicationRecord,
    ) -> ApplicationRecord:
        payload = record.job_keywords if isinstance(record.job_keywords, dict) else None
        if payload is None or payload.get("status") not in {"queued", "running"}:
            return record

        updated_at = self._parse_timestamp(str(payload.get("updated_at") or record.created_at))
        if updated_at is None:
            return record

        elapsed = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if elapsed < KEYWORD_EXTRACTION_STALE_TIMEOUT_SECONDS:
            return record

        logger.warning(
            "Recovering stale keyword extraction for application %s (status=%s, elapsed=%.0fs)",
            record.id,
            payload.get("status"),
            elapsed,
        )
        return await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates={
                "job_keywords": self._keyword_payload(
                    status="failed",
                    source_hash=str(payload.get("source_hash") or self._keyword_source_hash(record.job_description)),
                    preserve_manual_from=record.job_keywords,
                    job_id=str(payload.get("job_id") or "").strip() or None,
                    message="Keyword extraction timed out. Edit the job description to retry keyword extraction.",
                )
            },
        )

    def _is_generation_active(
        self,
        *,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> bool:
        if record.failure_reason is not None:
            return False

        if progress is not None and (progress.completed_at is not None or progress.terminal_error_code is not None):
            return False

        if record.internal_state in ACTIVE_GENERATION_STATES:
            return True

        if record.internal_state != "generation_pending" or progress is None:
            return False

        return (
            progress.state in ACTIVE_GENERATION_PROGRESS_STATES
            and progress.completed_at is None
            and progress.terminal_error_code is None
            and progress.workflow_kind == "generation"
        )

    def _is_extraction_active(
        self,
        *,
        record: ApplicationRecord,
        progress: Optional[ProgressRecord],
    ) -> bool:
        if record.failure_reason is not None:
            return False

        if record.internal_state not in ACTIVE_EXTRACTION_STATES:
            return False

        if progress is None:
            return True

        return progress.completed_at is None and progress.terminal_error_code is None

    async def _set_terminal_generation_progress(
        self,
        *,
        record: ApplicationRecord,
        previous_progress: Optional[ProgressRecord],
        target_state: str,
        message: str,
        terminal_error_code: str,
    ) -> None:
        completed_progress = build_progress(
            job_id=f"{terminal_error_code}-{record.id}-{int(datetime.now(timezone.utc).timestamp())}",
            workflow_kind=self._generation_workflow_kind(record, previous_progress),
            state=target_state,
            message=message,
            percent_complete=100,
            terminal_error_code=terminal_error_code,
            quota_period_start=previous_progress.quota_period_start if previous_progress is not None else None,
        )
        completed_progress.completed_at = completed_progress.updated_at
        await self.progress_store.set(record.id, completed_progress)

    async def _set_terminal_extraction_progress(
        self,
        *,
        record: ApplicationRecord,
        previous_progress: Optional[ProgressRecord],
        message: str,
        terminal_error_code: str,
    ) -> None:
        completed_progress = build_progress(
            job_id=f"extraction-stopped-{record.id}-{int(datetime.now(timezone.utc).timestamp())}",
            workflow_kind="extraction",
            state="manual_entry_required",
            message=message,
            percent_complete=100,
            terminal_error_code=terminal_error_code,
            created_at=previous_progress.created_at if previous_progress is not None else record.created_at,
        )
        completed_progress.completed_at = completed_progress.updated_at
        await self.progress_store.set(record.id, completed_progress)

    def _to_activity_payload(self, event: UsageEventRecord) -> ApplicationActivityPayload:
        metadata = event.metadata if isinstance(event.metadata, dict) else {}
        activity_type = str(metadata.get("activity_type") or "").strip() or self._legacy_activity_type(event)
        title, summary = self._activity_title_and_summary(activity_type)
        title = str(metadata.get("title") or title)
        summary = str(metadata.get("summary") or summary)

        details = metadata.get("details")
        sanitized_details = details if isinstance(details, dict) and details else None

        failure_message = metadata.get("failure_message")
        if failure_message is None and event.event_status == "failure":
            if isinstance(metadata.get("message"), str):
                failure_message = metadata.get("message")
            elif isinstance(sanitized_details, dict) and isinstance(sanitized_details.get("message"), str):
                failure_message = sanitized_details.get("message")
        if failure_message is not None and not isinstance(failure_message, str):
            failure_message = str(failure_message)

        attempts = self._sanitize_attempts_for_activity(metadata.get("attempts"))
        if attempts is None and isinstance(sanitized_details, dict):
            attempts = self._sanitize_attempts_for_activity(sanitized_details.get("attempts"))

        return ApplicationActivityPayload(
            id=event.id,
            type=activity_type,
            status=event.event_status,
            title=title,
            summary=summary,
            created_at=event.created_at,
            details=sanitized_details,
            failure_message=failure_message,
            attempts=attempts,
        )

    @staticmethod
    def _sanitize_attempts_for_activity(value: Any) -> Optional[list[dict[str, Any]]]:
        if not isinstance(value, list):
            return None
        sanitized: list[dict[str, Any]] = []
        for attempt in value:
            if not isinstance(attempt, dict):
                continue
            item: dict[str, Any] = {}
            for key in ("model", "reasoning_effort", "transport_mode", "outcome", "elapsed_ms", "retry_reason"):
                field = attempt.get(key)
                if field not in (None, ""):
                    item[key] = field
            if item:
                sanitized.append(item)
        return sanitized or None

    @staticmethod
    def _parse_iso_timestamp(timestamp_value: Optional[str]) -> Optional[datetime]:
        if not timestamp_value:
            return None
        try:
            parsed = datetime.fromisoformat(timestamp_value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        except Exception as e:
            logger.warning("Failed parsing ISO timestamp '%s': %s", timestamp_value, e)
            return None

    @staticmethod
    def _calculate_duration_ms(
        started_str: Optional[str],
        ended_str: Optional[str] = None
    ) -> Optional[int]:
        if not started_str:
            return None
        started = ApplicationService._parse_iso_timestamp(started_str)
        if started is None:
            return None
        if ended_str:
            ended = ApplicationService._parse_iso_timestamp(ended_str)
            if ended is None:
                return None
        else:
            ended = datetime.now(timezone.utc)
        duration = int((ended - started).total_seconds() * 1000)
        return max(duration, 0)

    @staticmethod
    def _timestamp_for_sort(timestamp_value: str) -> datetime:
        parsed = ApplicationService._parse_iso_timestamp(timestamp_value)
        return parsed if parsed is not None else datetime.fromtimestamp(0, tz=timezone.utc)

    @staticmethod
    def _progress_duration_ms(progress: ProgressRecord) -> Optional[int]:
        return ApplicationService._calculate_duration_ms(progress.created_at, progress.updated_at)

    @staticmethod
    def _get_judge_instructions(resume_judge_result: Optional[dict[str, Any]]) -> Optional[str]:
        if isinstance(resume_judge_result, dict):
            value = resume_judge_result.get("regeneration_instructions")
            if isinstance(value, str):
                return value.strip() or None
            if isinstance(value, dict):
                lines: list[str] = []
                for section_id, instructions in value.items():
                    if not isinstance(instructions, list):
                        continue
                    cleaned = [str(item).strip() for item in instructions if str(item).strip()]
                    if cleaned:
                        label = str(section_id).replace("_", " ").title()
                        lines.append(f"{label}:")
                        lines.extend(f"- {item}" for item in cleaned)
                return "\n".join(lines).strip() or None
        return None

    @staticmethod
    def _activity_title_and_summary(activity_type: str) -> tuple[str, str]:
        return ACTIVITY_CONTENT_MAP.get(
            activity_type,
            ("Activity updated", "An application activity was recorded."),
        )

    @staticmethod
    def _legacy_activity_type(event: UsageEventRecord) -> str:
        if event.event_type == "extraction":
            return "extraction_succeeded" if event.event_status == "success" else "extraction_failed"
        if event.event_type == "generation":
            if event.event_status == "failure":
                message = ""
                if isinstance(event.metadata, dict):
                    message = str(event.metadata.get("failure_message") or event.metadata.get("message") or "").lower()
                if "cancel" in message:
                    return "generation_cancelled"
                return "generation_failed"
            return "generation_succeeded"
        if event.event_type == "regeneration":
            return "regeneration_full_succeeded" if event.event_status == "success" else "regeneration_failed"
        if event.event_type == "export":
            return "export_succeeded" if event.event_status == "success" else "export_failed"
        return event.event_type

    def _record_activity_event(
        self,
        *,
        user_id: str,
        application_id: str,
        activity_type: str,
        status: str = "info",
        title: Optional[str] = None,
        summary: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
        failure_message: Optional[str] = None,
        attempts: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        metadata: dict[str, Any] = {"activity_type": activity_type}
        if title:
            metadata["title"] = title
        if summary:
            metadata["summary"] = summary
        if details:
            metadata["details"] = details
        if failure_message:
            metadata["failure_message"] = failure_message
        sanitized_attempts = self._sanitize_attempts_for_activity(attempts)
        if sanitized_attempts:
            metadata["attempts"] = sanitized_attempts
        self._record_usage_event(
            user_id=user_id,
            application_id=application_id,
            event_type=ACTIVITY_EVENT_TYPE,
            event_status=status,
            metadata=metadata,
        )

    def _application_url(self, application_id: str) -> str:
        return f"{self.settings.app_url.rstrip('/')}/app/applications/{application_id}"

    def _record_usage_event(
        self,
        *,
        user_id: str,
        event_type: str,
        event_status: str,
        application_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        if self.usage_event_repository is None:
            return
        try:
            self.usage_event_repository.create_usage_event(
                user_id=user_id,
                application_id=application_id,
                event_type=event_type,
                event_status=event_status,
                metadata=metadata,
            )
        except Exception:
            logger.exception(
                "Failed recording usage event. type=%s status=%s app_id=%s",
                event_type,
                event_status,
                application_id,
            )

    def _refresh(self, *, user_id: str, application_id: str) -> ApplicationRecord:
        refreshed = self.repository.fetch_application(user_id, application_id)
        if refreshed is None:
            raise LookupError("Application not found.")
        return refreshed

    def _require_application(self, *, user_id: str, application_id: str) -> ApplicationRecord:
        application = self.repository.fetch_application(user_id, application_id)
        if application is None:
            raise LookupError("Application not found.")
        return application

    async def _enqueue_source_capture(
        self,
        *,
        record: ApplicationRecord,
        job_url: Optional[str],
        capture: SourceCapturePayload,
        queued_message: str,
        failure_message: str,
    ) -> ApplicationRecord:
        try:
            job_id = await self.extraction_job_queue.enqueue(
                application_id=record.id,
                user_id=record.user_id,
                job_url=job_url,
                source_capture=capture.model_dump(),
            )
            await self.progress_store.set(
                record.id,
                build_progress(
                    job_id=job_id,
                    state="extraction_pending",
                    message=queued_message,
                    percent_complete=0,
                ),
            )
            return self._refresh(user_id=record.user_id, application_id=record.id)
        except Exception:
            fallback_job_id = f"failed-{record.id}"
            failed_progress = build_progress(
                job_id=fallback_job_id,
                state="manual_entry_required",
                message=failure_message,
                percent_complete=100,
                terminal_error_code="extraction_failed",
            )
            failed_progress.completed_at = failed_progress.updated_at
            await self.progress_store.set(record.id, failed_progress)
            return await self._mark_extraction_failure(record=record, message=failure_message)


def get_application_service(
    repository: ApplicationRepository = Depends(get_application_repository),
    base_resume_repository: BaseResumeRepository = Depends(get_base_resume_repository),
    draft_repository: ResumeDraftRepository = Depends(get_resume_draft_repository),
    profile_repository: ProfileRepository = Depends(get_profile_repository),
    notification_repository: NotificationRepository = Depends(get_notification_repository),
    progress_store: RedisProgressStore = Depends(get_progress_store),
    extraction_job_queue: ExtractionJobQueue = Depends(get_extraction_job_queue),
    generation_job_queue: GenerationJobQueue = Depends(get_generation_job_queue),
    keyword_extraction_job_queue: KeywordExtractionJobQueue = Depends(get_keyword_extraction_job_queue),
    usage_event_repository: UsageEventRepository = Depends(get_usage_event_repository),
    subscription_repository: SubscriptionRepository = Depends(get_subscription_repository),
    settings: Settings = Depends(get_settings),
) -> ApplicationService:
    return ApplicationService(
        repository=repository,
        base_resume_repository=base_resume_repository,
        draft_repository=draft_repository,
        profile_repository=profile_repository,
        notification_repository=notification_repository,
        progress_store=progress_store,
        extraction_job_queue=extraction_job_queue,
        generation_job_queue=generation_job_queue,
        keyword_extraction_job_queue=keyword_extraction_job_queue,
        email_sender=build_email_sender(settings),
        settings=settings,
        usage_event_repository=usage_event_repository,
        subscription_repository=subscription_repository,
    )
