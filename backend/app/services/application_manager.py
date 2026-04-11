from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
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
from app.services.pdf_export import generate_pdf
from app.services.progress import (
    ProgressRecord,
    RedisProgressStore,
    build_progress,
    get_progress_store,
)
from app.services.workflow import derive_visible_status

logger = logging.getLogger(__name__)

FULL_GENERATION_IDLE_TIMEOUT_SECONDS = 240
FULL_GENERATION_MAX_TIMEOUT_SECONDS = 540
SECTION_REGENERATION_IDLE_TIMEOUT_SECONDS = 120
SECTION_REGENERATION_MAX_TIMEOUT_SECONDS = 280
FULL_REGENERATION_LIMIT_PER_APPLICATION = 3
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
        updated = self.repository.update_application(
            application_id=application_id,
            user_id=user_id,
            updates=updates,
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
        updated = self.repository.update_application(
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

        updated = self.repository.update_application(
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

            updated = self.repository.update_application(
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

        updated = self.repository.update_application(
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

            updated = self.repository.update_application(
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

        updated = self.repository.update_application(
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

        updated = self.repository.update_application(
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

        self.draft_repository.upsert_draft(
            application_id=record.id,
            user_id=record.user_id,
            content_md=generated.content_md,
            generation_params=generated.generation_params,
            sections_snapshot=generated.sections_snapshot,
        )

        updated = self.repository.update_application(
            application_id=record.id,
            user_id=record.user_id,
            updates=self._workflow_updates(
                internal_state="resume_ready",
                failure_reason=None,
                generation_failure_details=None,
            ),
        )
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
            return self.repository.update_application(
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

            updated = self.repository.update_application(
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
        except Exception:
            failed = await self._mark_generation_failure(
                record=updated,
                message="Generation could not be started. Try again or adjust settings.",
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
            return self.repository.update_application(
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

            self.draft_repository.upsert_draft(
                application_id=record.id,
                user_id=record.user_id,
                content_md=payload.generated.content_md,
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = self.repository.update_application(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
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
        except Exception:
            failed = await self._mark_generation_failure(
                record=updated,
                message="Full regeneration could not be started. Try again.",
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
        generation_settings = draft.generation_params

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
        except Exception:
            failed = await self._mark_generation_failure(
                record=updated,
                message="Section regeneration could not be started. Try again.",
                failure_reason="regeneration_failed",
            )
            return self._detail_payload(failed)

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
            return self.repository.update_application(
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

            self.draft_repository.upsert_draft(
                application_id=record.id,
                user_id=record.user_id,
                content_md=payload.generated.content_md,
                generation_params=payload.generated.generation_params,
                sections_snapshot=payload.generated.sections_snapshot,
            )

            updated = self.repository.update_application(
                application_id=record.id,
                user_id=record.user_id,
                updates=self._workflow_updates(
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

    async def get_draft(
        self, *, user_id: str, application_id: str,
    ) -> Optional[ResumeDraftRecord]:
        self._require_application(user_id=user_id, application_id=application_id)
        return self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)

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

        if record.internal_state == "resume_ready" or has_export:
            updated_vs = derive_visible_status(
                internal_state="resume_ready",
                failure_reason=None,
                has_successful_export=has_export,
                draft_changed_since_export=draft_changed,
            )
            self.repository.update_application(
                application_id=application_id,
                user_id=user_id,
                updates={
                    "internal_state": "resume_ready",
                    "failure_reason": None,
                    "visible_status": updated_vs,
                },
            )

        return updated_draft

    async def export_pdf(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> tuple[bytes, str]:
        """Generate and return PDF bytes and filename.

        Returns (pdf_bytes, filename).
        """
        record = self._require_application(user_id=user_id, application_id=application_id)

        draft = self.draft_repository.fetch_draft(user_id=user_id, application_id=application_id)
        if draft is None:
            raise PermissionError("No draft exists. Generation must happen first.")

        profile = self._require_profile(user_id=user_id, action="exporting a PDF")
        self._require_profile_name(profile, action="exporting a PDF")
        personal_info = self._build_personal_info(profile)
        full_name = (self._clean_profile_value(profile.name) or "resume").replace(" ", "_")

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"{full_name}_resume_{timestamp}.pdf"

        try:
            pdf_bytes = await generate_pdf(
                markdown_content=draft.content_md,
                personal_info=personal_info,
                page_length=str(draft.generation_params.get("page_length") or "1_page"),
            )
        except asyncio.TimeoutError:
            await self._handle_export_failure(
                record=record,
                message="PDF export timed out. Please try again.",
            )
            raise ValueError("PDF export timed out.")
        except Exception as exc:
            logger.exception("PDF export failed for application %s", application_id)
            await self._handle_export_failure(
                record=record,
                message="PDF export failed. Please try again.",
            )
            raise ValueError("PDF export failed.") from exc

        # Success: update exported_at, last_exported_at, status
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
            message="PDF export completed successfully.",
            action_required=False,
        )
        self._record_usage_event(
            user_id=user_id,
            application_id=application_id,
            event_type="export",
            event_status="success",
        )

        return pdf_bytes, filename

    async def _handle_export_failure(
        self,
        *,
        record: ApplicationRecord,
        message: str,
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
                    subject="Applix: PDF export failed",
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
            return self.repository.update_application(
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
            return self.repository.update_application(
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
            return self.repository.update_application(
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

        updated = self.repository.update_application(
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
        updated = self.repository.update_application(
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
        updated = self.repository.update_application(
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
        updated = self.repository.update_application(
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
