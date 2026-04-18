from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Optional

from fastapi import Depends
from pydantic import BaseModel, Field, field_validator

from app.core.config import Settings, get_settings
from app.db.admin import AdminRepository, get_admin_repository
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
from app.services.duplicates import DuplicateDetector
from app.services.email import EmailMessage, EmailSender, build_email_sender
from app.services.jobs import (
    ExtractionJobQueue,
    GenerationJobQueue,
    get_extraction_job_queue,
    get_generation_job_queue,
)
from app.services.pdf_export import generate_docx, generate_pdf
from app.services.progress import (
    ApplicationEvent,
    ProgressRecord,
    RedisProgressStore,
    build_progress,
    get_progress_store,
)
from app.services.resume_privacy import sanitize_resume_markdown
from app.services.workflow import derive_visible_status

logger = logging.getLogger(__name__)

FULL_GENERATION_IDLE_TIMEOUT_SECONDS = 240
FULL_GENERATION_MAX_TIMEOUT_SECONDS = 240
SECTION_REGENERATION_IDLE_TIMEOUT_SECONDS = 120
SECTION_REGENERATION_MAX_TIMEOUT_SECONDS = 120
FULL_REGENERATION_LIMIT_PER_APPLICATION = 3
RESUME_JUDGE_RUN_LIMIT_PER_DRAFT = 3
ACTIVE_GENERATION_STATES = {"generating", "regenerating_full", "regenerating_section"}
ACTIVE_GENERATION_PROGRESS_STATES = {
    "generation_pending",
    "generating",
    "regenerating_full",
    "regenerating_section",
}
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


class DuplicateWarningPayload(BaseModel):
    similarity_score: float
    matched_fields: list[str]
    match_basis: str
    matched_application: MatchedApplicationRecord


class ApplicationDetailPayload(BaseModel):
    application: ApplicationRecord
    duplicate_warning: Optional[DuplicateWarningPayload]


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
    regeneration_instructions: Optional[str] = None
    regeneration_priority_dimensions: list[str] = Field(default_factory=list)
    evaluator_notes: Optional[str] = None
    evaluated_draft_updated_at: Optional[str] = None
    scored_at: Optional[str] = None
    job_context_signature: Optional[str] = None
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
    result: Optional[ResumeJudgeResultPayload] = None
    failure: Optional[ResumeJudgeFailurePayload] = None


class GenerationCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    generated: Optional[GenerationSuccessPayload] = None
    failure: Optional[GenerationFailurePayload] = None


class RegenerationCallbackPayload(BaseModel):
    application_id: str
    user_id: str
    job_id: str
    event: str
    regeneration_target: str = "full"
    generated: Optional[GenerationSuccessPayload] = None
    failure: Optional[GenerationFailurePayload] = None


class DraftReviewFlagPayload(BaseModel):
    section_name: str
    text: str
    reason: str = "job_description_only_addition"


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
        admin_repository: Optional[AdminRepository] = None,
    ) -> None:
        self.repository = repository
        self.base_resume_repository = base_resume_repository
        self.draft_repository = draft_repository
        self.profile_repository = profile_repository
        self.notification_repository = notification_repository
        self.progress_store = progress_store
        self.extraction_job_queue = extraction_job_queue
        self.generation_job_queue = generation_job_queue
        self.email_sender = email_sender
        self.settings = settings
        self.admin_repository = admin_repository
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
        record = self.repository.create_application(
            user_id=user_id,
            job_url=job_url,
            visible_status="draft",
            internal_state="extraction_pending",
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
        job_url: str,
        capture: SourceCapturePayload,
    ) -> ApplicationRecord:
        record = self.repository.create_application(
            user_id=user_id,
            job_url=job_url,
            visible_status="draft",
            internal_state="extraction_pending",
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

        return self._detail_payload(record)

    async def patch_application(
        self,
        *,
        user_id: str,
        application_id: str,
        updates: dict[str, Any],
    ) -> ApplicationDetailPayload:
        current = self._require_application(user_id=user_id, application_id=application_id)
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
                current_run_attempt_count = self._resume_judge_run_attempt_count(
                    current.resume_judge_result,
                    draft_updated_at=draft.updated_at,
                    job_context_signature=self._resume_judge_signature_for_record(current),
                )
                merged_updates["resume_judge_result"] = self._resume_judge_status_payload(
                    status="failed",
                    message="Resume Judge needs another run because the job details changed.",
                    evaluated_draft_updated_at=draft.updated_at,
                    scored_at=datetime.now(timezone.utc).isoformat(),
                    run_attempt_count=current_run_attempt_count or None,
                    job_context_signature=self._resume_judge_job_context_signature(
                        job_title=updates.get("job_title", current.job_title),
                        company_name=updates.get("company", current.company),
                        job_description=updates.get("job_description", current.job_description),
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
        updated = await self._run_duplicate_resolution_flow(updated)
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

            recovered_success = await self._reconcile_generation_success_from_progress_cache(
                record=record,
                progress=progress,
            )
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
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="extraction",
            event_status="success",
        )
        return await self._run_duplicate_resolution_flow(updated)

    async def _reconcile_generation_success_from_progress_cache(
        self,
        *,
        record: ApplicationRecord,
        progress: ProgressRecord,
    ) -> Optional[ApplicationRecord]:
        cached_result = await self.progress_store.get_generation_result(record.id)
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

        draft = self.draft_repository.upsert_draft(
            application_id=record.id,
            user_id=record.user_id,
            content_md=generated.content_md,
            generation_params=generated.generation_params,
            sections_snapshot=generated.sections_snapshot,
        )

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="resume_ready",
                failure_reason=None,
                generation_failure_details=None,
            ),
        )
        updated = await self._enqueue_resume_judge_for_draft(record=updated, draft=draft)
        await self.progress_store.clear_generation_result(record.id)
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
                self._record_usage_event(
                    user_id=record.user_id,
                    application_id=record.id,
                    event_type="generation",
                    event_status="success",
                )
            else:
                self.notification_repository.create_notification(
                    user_id=record.user_id,
                    application_id=record.id,
                    notification_type="success",
                    message="Resume regeneration completed successfully.",
                    action_required=False,
                )
                await self._send_generation_email(
                    record=updated,
                    subject="Applix: resume regenerated",
                    body="Your resume has been regenerated and is ready for review.",
                )
                self._record_usage_event(
                    user_id=record.user_id,
                    application_id=record.id,
                    event_type="regeneration",
                    event_status="success",
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
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="extracting",
                    failure_reason=None,
                    extraction_failure_details=None,
                ),
            )

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
            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="extraction",
                event_status="success",
            )
            return await self._run_duplicate_resolution_flow(updated)

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

        if record.internal_state not in ("generation_pending", "resume_ready"):
            raise PermissionError("Application is not ready for generation.")

        if not record.job_title or not record.job_description:
            raise ValueError("Job title and description are required before generation.")

        if self._looks_like_blocked_source_placeholder(record):
            return await self._route_blocked_job_data_to_manual_entry(record)

        if record.duplicate_resolution_status == "pending":
            raise PermissionError("Unresolved duplicate must be resolved before generation.")

        base_resume = self.base_resume_repository.fetch_resume(user_id, base_resume_id)
        if base_resume is None:
            raise LookupError("Base resume not found.")

        profile = self._require_profile(user_id=user_id, action="generating a resume")
        self._require_profile_name(profile, action="generating a resume")
        personal_info = self._build_personal_info(profile)

        section_prefs = self._build_section_preferences(profile)

        generation_settings = {
            "page_length": target_length,
            "aggressiveness": aggressiveness,
            "additional_instructions": additional_instructions,
            "base_resume_id": base_resume_id,
            "_base_resume_snapshot_content": base_resume.content_md,
        }

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

        try:
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
                ),
            )
            return self._detail_payload(updated)
        except Exception as error:
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
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="generating",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )

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
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)

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
                content_md=payload.generated.content_md,
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="resume_ready",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            updated = await self._enqueue_resume_judge_for_draft(record=updated, draft=draft)

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
            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="generation",
                event_status="success",
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
        is_admin_profile = self._profile_is_admin(profile)
        if (
            not is_admin_profile
            and record.full_regeneration_count >= FULL_REGENERATION_LIMIT_PER_APPLICATION
        ):
            raise PermissionError(
                "You have reached the full regeneration limit for this resume. "
                "Please contact an administrator for additional regenerations."
            )
        personal_info = self._build_personal_info(profile)

        section_prefs = self._build_section_preferences(profile)
        generation_settings = {
            "page_length": target_length,
            "aggressiveness": aggressiveness,
            "additional_instructions": additional_instructions,
            "base_resume_id": base_resume_id,
            "_base_resume_snapshot_content": base_resume.content_md,
        }

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

        try:
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
                regeneration_instructions=additional_instructions,
            )
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
            if not is_admin_profile:
                updated = self.repository.update_application(
                    application_id=application_id,
                    user_id=user_id,
                    updates={
                        "full_regeneration_count": updated.full_regeneration_count + 1,
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
                ),
            )
            return self._detail_payload(updated)
        except Exception as error:
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
        generation_settings = {
            **draft.generation_params,
            "base_resume_id": base_resume_id,
            "_base_resume_snapshot_content": base_resume.content_md,
        }

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

        try:
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
                ),
            )
            return self._detail_payload(updated)
        except Exception as error:
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
            failed = await self._mark_generation_failure(
                record=updated,
                message="Section regeneration could not be started. Try again.",
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

        is_section = payload.regeneration_target != "full"
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
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state=generating_state,
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )

        if payload.event == "failed":
            await self.progress_store.clear_generation_result(record.id)
            failure_msg = payload.failure.message if payload.failure else "Regeneration failed."
            failure_details = payload.failure.failure_details if payload.failure else None

            completed_progress = build_progress(
                job_id=payload.job_id,
                workflow_kind=workflow_kind,
                state="regeneration_failed",
                message=failure_msg,
                percent_complete=100,
                terminal_error_code=failure_reason,
            )
            completed_progress.completed_at = completed_progress.updated_at
            await self.progress_store.set(record.id, completed_progress)

            return await self._mark_generation_failure(
                record=record,
                message=failure_msg,
                failure_details=failure_details,
                failure_reason=failure_reason,
            )

        if payload.event == "succeeded":
            if payload.generated is None:
                raise ValueError("Missing generated payload for regeneration success callback.")

            draft = self.draft_repository.upsert_draft(
                application_id=record.id,
                user_id=record.user_id,
                content_md=payload.generated.content_md,
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
                    internal_state="resume_ready",
                    failure_reason=None,
                    generation_failure_details=None,
                ),
            )
            updated = await self._enqueue_resume_judge_for_draft(record=updated, draft=draft)

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
                message="Resume regeneration completed successfully.",
                action_required=False,
            )
            await self._send_generation_email(
                record=updated,
                subject="Applix: resume regenerated",
                body="Your resume has been regenerated and is ready for review.",
            )
            self._record_usage_event(
                user_id=record.user_id,
                application_id=record.id,
                event_type="regeneration",
                event_status="success",
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

        if draft.updated_at != payload.evaluated_draft_updated_at:
            return record

        current_run_attempt_count = self._resume_judge_run_attempt_count(
            record.resume_judge_result,
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
                    )
                },
            )

        if payload.event == "failed":
            if payload.failure is None:
                raise ValueError("Missing Resume Judge failure payload.")
            failure_result = payload.failure.result.model_dump()
            if current_run_attempt_count:
                failure_result["run_attempt_count"] = current_run_attempt_count
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
            if current_run_attempt_count:
                success_result["run_attempt_count"] = current_run_attempt_count
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": success_result
                },
            )

        raise ValueError("Unsupported Resume Judge callback event.")

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
    ) -> tuple[Optional[ResumeDraftRecord], list[DraftReviewFlagPayload]]:
        record = self._require_application(user_id=user_id, application_id=application_id)
        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            return None, []
        return draft, self._build_job_description_addition_flags(record=record, draft=draft)

    async def save_draft_edit(
        self,
        *,
        user_id: str,
        application_id: str,
        content: str,
    ) -> ResumeDraftRecord:
        record = self._require_application(user_id=user_id, application_id=application_id)

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No draft exists. Generation must happen first.")

        updated_draft = self.draft_repository.update_draft_content(
            application_id=application_id,
            user_id=user_id,
            content_md=content,
        )

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
        if record.resume_judge_result is not None:
            current_run_attempt_count = self._resume_judge_run_attempt_count(
                record.resume_judge_result,
                draft_updated_at=str(record.resume_judge_result.get("evaluated_draft_updated_at") or ""),
                job_context_signature=self._resume_judge_signature_for_record(record),
            )
            application_updates["resume_judge_result"] = self._resume_judge_status_payload(
                status="failed",
                message="Resume Judge needs another run because the draft changed.",
                evaluated_draft_updated_at=updated_draft.updated_at,
                scored_at=datetime.now(timezone.utc).isoformat(),
                run_attempt_count=current_run_attempt_count or None,
                job_context_signature=self._resume_judge_signature_for_record(record),
                failure_stage="stale_draft",
            )
        if application_updates:
            self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates=application_updates,
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
                markdown_content=draft.content_md,
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

        self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates={
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "internal_state": "resume_ready",
                "failure_reason": None,
                "visible_status": derive_visible_status(
                    internal_state="resume_ready",
                    failure_reason=None,
                    has_successful_export=True,
                    draft_changed_since_export=False,
                ),
            },
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
        self._record_usage_event(
            user_id=record.user_id,
            application_id=record.id,
            event_type="regeneration" if "regeneration" in failure_reason else "generation",
            event_status="failure",
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

    def _require_profile_name(self, profile, *, action: str) -> None:
        if not self._clean_profile_value(getattr(profile, "name", None)):
            raise ValueError(f"Complete your profile name before {action}.")

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
        order = profile.section_order or []
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

    def _detail_payload(self, record: ApplicationRecord) -> ApplicationDetailPayload:
        warning = None
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
        return ApplicationDetailPayload(application=record, duplicate_warning=warning)

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
        draft_updated_at: str,
        job_context_signature: str,
    ) -> int:
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return 0
        if str(resume_judge_result.get("evaluated_draft_updated_at") or "") != draft_updated_at:
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
    def _should_enqueue_resume_judge(
        resume_judge_result: Optional[dict[str, Any]],
        *,
        draft_updated_at: str,
        force: bool = False,
    ) -> bool:
        if force:
            return True
        if not isinstance(resume_judge_result, dict) or not resume_judge_result:
            return True
        return str(resume_judge_result.get("evaluated_draft_updated_at") or "") != draft_updated_at

    async def _enqueue_resume_judge_for_draft(
        self,
        *,
        record: ApplicationRecord,
        draft: ResumeDraftRecord,
        force: bool = False,
    ) -> ApplicationRecord:
        if not self._should_enqueue_resume_judge(
            record.resume_judge_result,
            draft_updated_at=draft.updated_at,
            force=force,
        ):
            return record

        current_job_context_signature = self._resume_judge_signature_for_record(record)
        current_run_attempt_count = self._resume_judge_run_attempt_count(
            record.resume_judge_result,
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
                return await self._update_application_and_publish_detail(
                    application_id=record.id,
                    user_id=record.user_id,
                    updates={
                        "resume_judge_result": self._resume_judge_status_payload(
                            status="failed",
                            message="Resume Judge could not run because the source base resume is unavailable.",
                            evaluated_draft_updated_at=draft.updated_at,
                            scored_at=datetime.now(timezone.utc).isoformat(),
                            job_context_signature=current_job_context_signature,
                            failure_stage="precondition",
                        )
                    },
                )

            base_resume = self.base_resume_repository.fetch_resume(record.user_id, base_resume_id)
            if base_resume is None:
                return await self._update_application_and_publish_detail(
                    application_id=record.id,
                    user_id=record.user_id,
                    updates={
                        "resume_judge_result": self._resume_judge_status_payload(
                            status="failed",
                            message="Resume Judge could not run because the linked base resume was not found.",
                            evaluated_draft_updated_at=draft.updated_at,
                            scored_at=datetime.now(timezone.utc).isoformat(),
                            job_context_signature=current_job_context_signature,
                            failure_stage="precondition",
                        )
                    },
                )
            base_resume_content = base_resume.content_md

        if not record.job_title or not record.job_description:
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": self._resume_judge_status_payload(
                        status="failed",
                        message="Resume Judge could not run because the application is missing job details.",
                        evaluated_draft_updated_at=draft.updated_at,
                        scored_at=datetime.now(timezone.utc).isoformat(),
                        job_context_signature=current_job_context_signature,
                        failure_stage="precondition",
                    )
                },
            )

        updated = await self._update_application_and_publish_detail(
            application_id=record.id,
            user_id=record.user_id,
            updates={
                "resume_judge_result": self._resume_judge_status_payload(
                    status="queued",
                    message="Resume Judge is queued.",
                    evaluated_draft_updated_at=draft.updated_at,
                    run_attempt_count=current_run_attempt_count + 1,
                    job_context_signature=current_job_context_signature,
                )
            },
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
            )
            return updated
        except Exception as error:
            return await self._update_application_and_publish_detail(
                application_id=record.id,
                user_id=record.user_id,
                updates={
                    "resume_judge_result": self._resume_judge_status_payload(
                        status="failed",
                        message="Resume Judge could not be started. Score unavailable.",
                        evaluated_draft_updated_at=draft.updated_at,
                        scored_at=datetime.now(timezone.utc).isoformat(),
                        job_context_signature=current_job_context_signature,
                        failure_stage="enqueue",
                        error={
                            "error_type": type(error).__name__,
                            "message": str(error),
                        },
                    )
                },
            )

    @staticmethod
    def _normalize_search_text(value: str) -> str:
        lowered = str(value or "").lower()
        lowered = re.sub(r"[^a-z0-9+#/ -]+", " ", lowered)
        return re.sub(r"\s+", " ", lowered).strip()

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

        for key in ("failure_stage", "attempt_count", "terminal_error_code", "repair_model"):
            value = failure_details.get(key)
            if value not in (None, ""):
                normalized[key] = value

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
        if self.admin_repository is None:
            return
        try:
            self.admin_repository.create_usage_event(
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
        job_url: str,
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
    admin_repository: AdminRepository = Depends(get_admin_repository),
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
        email_sender=build_email_sender(settings),
        settings=settings,
        admin_repository=admin_repository,
    )
