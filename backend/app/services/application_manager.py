from __future__ import annotations

from typing import Any, Optional

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
from app.db.notifications import NotificationRepository, get_notification_repository
from app.db.profiles import ProfileRepository, get_profile_repository
from app.services.duplicates import DuplicateDetector
from app.services.email import EmailMessage, EmailSender, build_email_sender
from app.services.jobs import ExtractionJobQueue, get_extraction_job_queue
from app.services.progress import (
    ProgressRecord,
    RedisProgressStore,
    build_progress,
    get_progress_store,
)
from app.services.workflow import derive_visible_status


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


class ApplicationService:
    def __init__(
        self,
        *,
        repository: ApplicationRepository,
        profile_repository: ProfileRepository,
        notification_repository: NotificationRepository,
        progress_store: RedisProgressStore,
        extraction_job_queue: ExtractionJobQueue,
        email_sender: EmailSender,
        settings: Settings,
    ) -> None:
        self.repository = repository
        self.profile_repository = profile_repository
        self.notification_repository = notification_repository
        self.progress_store = progress_store
        self.extraction_job_queue = extraction_job_queue
        self.email_sender = email_sender
        self.settings = settings
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

    async def get_progress(self, *, user_id: str, application_id: str) -> ProgressRecord:
        record = self._require_application(user_id=user_id, application_id=application_id)
        progress = await self.progress_store.get(application_id)
        if progress is not None:
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
            return await self._run_duplicate_resolution_flow(updated)

        raise ValueError("Unsupported worker event.")

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
        return updated

    async def _set_action_required(
        self,
        *,
        record: ApplicationRecord,
        notification_type: str,
        message: str,
        send_email: bool,
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
            await self.email_sender.send(
                EmailMessage(
                    to=[self._recipient_email(record)],
                    subject="Resume Builder: extraction needs manual entry",
                    text=(
                        f"{message}\n\n"
                        f"Open the application: {self._application_url(record.id)}"
                    ),
                )
            )

    def _recipient_email(self, record: ApplicationRecord) -> str:
        profile = self.profile_repository.fetch_profile(record.user_id)
        if profile is None:
            raise ValueError("Authenticated profile is unavailable.")
        return profile.email

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
        if record.internal_state == "manual_entry_required":
            if record.extraction_failure_details and record.extraction_failure_details.get("kind") == "blocked_source":
                return "This source blocked automated retrieval. Paste the job text or complete manual entry."
            return "Extraction failed. Manual entry is required."
        if record.internal_state == "duplicate_review_required":
            return "Duplicate review is required before generation."
        if record.internal_state == "generation_pending":
            return "Extraction completed."
        if record.internal_state == "extracting":
            return "Extraction is running."
        return "Extraction is queued."

    def _application_url(self, application_id: str) -> str:
        return f"{self.settings.app_url.rstrip('/')}/app/applications/{application_id}"

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
    profile_repository: ProfileRepository = Depends(get_profile_repository),
    notification_repository: NotificationRepository = Depends(get_notification_repository),
    progress_store: RedisProgressStore = Depends(get_progress_store),
    extraction_job_queue: ExtractionJobQueue = Depends(get_extraction_job_queue),
    settings: Settings = Depends(get_settings),
) -> ApplicationService:
    return ApplicationService(
        repository=repository,
        profile_repository=profile_repository,
        notification_repository=notification_repository,
        progress_store=progress_store,
        extraction_job_queue=extraction_job_queue,
        email_sender=build_email_sender(settings),
        settings=settings,
    )
