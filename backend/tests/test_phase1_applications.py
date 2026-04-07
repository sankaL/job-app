from __future__ import annotations

from typing import Any, Optional

import pytest
from fastapi.testclient import TestClient

from app.db.applications import (
    ApplicationListRecord,
    ApplicationRecord,
    DuplicateCandidateRecord,
    MatchedApplicationRecord,
)
from app.main import app
from app.services.application_manager import (
    ApplicationService,
    SourceCapturePayload,
    WorkerCallbackPayload,
    WorkerSuccessPayload,
)
from app.services.progress import ProgressRecord


class FakeApplicationRepository:
    def __init__(self) -> None:
        self.records: dict[str, ApplicationRecord] = {}
        self.counter = 0

    def list_applications(self, user_id: str, *, search: Optional[str], visible_status: Optional[str]) -> list[ApplicationListRecord]:
        records = [
            ApplicationListRecord.model_validate(
                {
                    **record.model_dump(),
                    "has_action_required_notification": record.has_action_required_notification,
                }
            )
            for record in self.records.values()
            if record.user_id == user_id
        ]
        return records

    def create_application(self, *, user_id: str, job_url: str, visible_status: str, internal_state: str) -> ApplicationRecord:
        self.counter += 1
        record = ApplicationRecord(
            id=f"app-{self.counter}",
            user_id=user_id,
            job_url=job_url,
            job_title=None,
            company=None,
            job_description=None,
            extracted_reference_id=None,
            job_posting_origin=None,
            job_posting_origin_other_text=None,
            base_resume_id=None,
            base_resume_name=None,
            visible_status=visible_status,
            internal_state=internal_state,
            failure_reason=None,
            extraction_failure_details=None,
            applied=False,
            duplicate_similarity_score=None,
            duplicate_match_fields=None,
            duplicate_resolution_status=None,
            duplicate_matched_application_id=None,
            notes=None,
            exported_at=None,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            has_action_required_notification=False,
        )
        self.records[record.id] = record
        return record

    def fetch_application(self, user_id: str, application_id: str) -> Optional[ApplicationRecord]:
        record = self.records.get(application_id)
        if record and record.user_id == user_id:
            return record
        return None

    def fetch_application_unscoped(self, application_id: str) -> Optional[ApplicationRecord]:
        return self.records.get(application_id)

    def fetch_matched_application(self, *, user_id: str, application_id: str) -> Optional[MatchedApplicationRecord]:
        record = self.fetch_application(user_id, application_id)
        if record is None:
            return None
        return MatchedApplicationRecord(
            id=record.id,
            job_url=record.job_url,
            job_title=record.job_title,
            company=record.company,
            visible_status=record.visible_status,
        )

    def fetch_duplicate_candidates(self, *, user_id: str, exclude_application_id: str) -> list[DuplicateCandidateRecord]:
        return [
            DuplicateCandidateRecord(
                id=record.id,
                job_url=record.job_url,
                job_title=record.job_title,
                company=record.company,
                job_description=record.job_description,
                extracted_reference_id=record.extracted_reference_id,
                job_posting_origin=record.job_posting_origin,
                job_posting_origin_other_text=record.job_posting_origin_other_text,
            )
            for record in self.records.values()
            if record.user_id == user_id and record.id != exclude_application_id
        ]

    def update_application(self, *, application_id: str, user_id: str, updates: dict[str, Any]) -> ApplicationRecord:
        record = self.fetch_application(user_id, application_id)
        if record is None:
            raise LookupError("Application not found.")
        updated = record.model_copy(update={**updates, "updated_at": "2026-04-07T12:10:00+00:00"})
        self.records[application_id] = updated
        return updated


class FakeProfileRepository:
    def __init__(self) -> None:
        self.extension_connected = False
        self.extension_token_hash: str | None = None
        self.extension_token_created_at: str | None = None
        self.extension_token_last_used_at: str | None = None

    def fetch_profile(self, user_id: str):
        class Profile:
            email = "invite-only@example.com"

        return Profile()

    def fetch_extension_connection(self, user_id: str):
        from app.db.profiles import ExtensionConnectionRecord

        return ExtensionConnectionRecord(
            connected=self.extension_connected,
            token_created_at=self.extension_token_created_at,
            token_last_used_at=self.extension_token_last_used_at,
        )

    def fetch_extension_owner_by_token_hash(self, token_hash: str):
        if token_hash != self.extension_token_hash:
            return None

        class Owner:
            id = "user-1"
            email = "invite-only@example.com"

        return Owner()

    def upsert_extension_token(self, *, user_id: str, token_hash: str):
        from app.db.profiles import ExtensionConnectionRecord

        self.extension_connected = True
        self.extension_token_hash = token_hash
        self.extension_token_created_at = "2026-04-07T12:10:00+00:00"
        self.extension_token_last_used_at = None
        return ExtensionConnectionRecord(
            connected=True,
            token_created_at=self.extension_token_created_at,
            token_last_used_at=None,
        )

    def clear_extension_token(self, *, user_id: str):
        from app.db.profiles import ExtensionConnectionRecord

        self.extension_connected = False
        self.extension_token_hash = None
        self.extension_token_created_at = None
        self.extension_token_last_used_at = None
        return ExtensionConnectionRecord(
            connected=False,
            token_created_at=None,
            token_last_used_at=None,
        )

    def touch_extension_token(self, *, user_id: str) -> None:
        self.extension_token_last_used_at = "2026-04-07T12:12:00+00:00"


class FakeNotificationRepository:
    def __init__(self) -> None:
        self.notifications: list[dict[str, Any]] = []

    def clear_action_required(self, *, user_id: str, application_id: str) -> None:
        for notification in self.notifications:
            if notification["user_id"] == user_id and notification["application_id"] == application_id:
                notification["action_required"] = False

    def create_notification(
        self,
        *,
        user_id: str,
        application_id: str,
        notification_type: str,
        message: str,
        action_required: bool,
    ) -> None:
        self.notifications.append(
            {
                "user_id": user_id,
                "application_id": application_id,
                "notification_type": notification_type,
                "message": message,
                "action_required": action_required,
            }
        )


class FakeProgressStore:
    def __init__(self) -> None:
        self.progress: dict[str, ProgressRecord] = {}

    async def get(self, application_id: str) -> Optional[ProgressRecord]:
        return self.progress.get(application_id)

    async def set(self, application_id: str, progress: ProgressRecord, ttl_seconds: int = 86400) -> None:
        self.progress[application_id] = progress


class FakeExtractionJobQueue:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.enqueued: list[dict[str, str]] = []

    async def enqueue(
        self,
        *,
        application_id: str,
        user_id: str,
        job_url: str,
        source_capture: Optional[dict[str, Any]] = None,
    ) -> str:
        if self.should_fail:
            raise RuntimeError("queue unavailable")
        job_id = f"job-{len(self.enqueued) + 1}"
        self.enqueued.append(
            {
                "application_id": application_id,
                "user_id": user_id,
                "job_url": job_url,
                "job_id": job_id,
                "source_capture": source_capture,
            }
        )
        return job_id


class FakeEmailSender:
    def __init__(self) -> None:
        self.messages: list[Any] = []

    async def send(self, message):
        self.messages.append(message)
        return "email-1"


def build_service(*, queue_should_fail: bool = False) -> tuple[ApplicationService, FakeApplicationRepository, FakeNotificationRepository, FakeProgressStore, FakeExtractionJobQueue, FakeEmailSender]:
    repository = FakeApplicationRepository()
    notifications = FakeNotificationRepository()
    progress = FakeProgressStore()
    queue = FakeExtractionJobQueue(should_fail=queue_should_fail)
    email = FakeEmailSender()
    profiles = FakeProfileRepository()
    service = ApplicationService(
        repository=repository,
        profile_repository=profiles,
        notification_repository=notifications,
        progress_store=progress,
        extraction_job_queue=queue,
        email_sender=email,
        settings=type(
            "Settings",
            (),
            {"duplicate_similarity_threshold": 85.0, "app_url": "http://localhost:5173"},
        )(),
    )
    return service, repository, notifications, progress, queue, email


@pytest.mark.asyncio
async def test_create_application_queues_extraction_and_seeds_progress():
    service, _, _, progress_store, queue, _ = build_service()

    record = await service.create_application(user_id="user-1", job_url="https://example.com/jobs/1")

    assert record.internal_state == "extraction_pending"
    assert queue.enqueued[0]["application_id"] == record.id
    assert (await progress_store.get(record.id)) is not None
    assert (await progress_store.get(record.id)).job_id == "job-1"


@pytest.mark.asyncio
async def test_create_application_falls_back_to_manual_entry_when_queue_fails():
    service, _, notifications, progress_store, _, email = build_service(queue_should_fail=True)

    record = await service.create_application(user_id="user-1", job_url="https://example.com/jobs/1")

    assert record.internal_state == "manual_entry_required"
    assert record.failure_reason == "extraction_failed"
    assert notifications.notifications[-1]["action_required"] is True
    assert len(email.messages) == 1
    assert (await progress_store.get(record.id)).terminal_error_code == "extraction_failed"


@pytest.mark.asyncio
async def test_manual_entry_with_duplicate_candidate_marks_duplicate_review_required():
    service, repository, notifications, _, _, _ = build_service()
    existing = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=existing.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs for customers.",
            "job_posting_origin": "linkedin",
        },
    )

    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1?duplicate=true",
        visible_status="needs_action",
        internal_state="manual_entry_required",
    )
    detail = await service.complete_manual_entry(
        user_id="user-1",
        application_id=created.id,
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs for customers.",
            "job_posting_origin": "linkedin",
            "job_posting_origin_other_text": None,
            "notes": None,
        },
    )

    assert detail.application.internal_state == "duplicate_review_required"
    assert detail.application.duplicate_resolution_status == "pending"
    assert detail.duplicate_warning is not None
    assert notifications.notifications[-1]["notification_type"] == "warning"


@pytest.mark.asyncio
async def test_patching_manual_entry_fields_keeps_manual_entry_state_until_submit():
    service, repository, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="needs_action",
        internal_state="manual_entry_required",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "failure_reason": "extraction_failed",
            "extraction_failure_details": {
                "kind": "blocked_source",
                "provider": "indeed",
            },
        },
    )

    updated = await service.patch_application(
        user_id="user-1",
        application_id=created.id,
        updates={"job_title": "Backend Engineer"},
    )

    assert updated.application.internal_state == "manual_entry_required"
    assert updated.application.failure_reason == "extraction_failed"
    assert updated.application.extraction_failure_details is not None
    assert updated.application.job_title == "Backend Engineer"


@pytest.mark.asyncio
async def test_missing_company_skips_duplicate_then_rechecks_when_company_is_added():
    service, repository, _, _, _, _ = build_service()
    candidate = repository.create_application(
        user_id="user-1",
        job_url="https://www.linkedin.com/jobs/view/123456",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=candidate.id,
        user_id="user-1",
        updates={
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Build resilient APIs and queues.",
            "job_posting_origin": "linkedin",
        },
    )

    current = repository.create_application(
        user_id="user-1",
        job_url="https://www.linkedin.com/jobs/view/123456",
        visible_status="draft",
        internal_state="extraction_pending",
    )
    detail = await service.handle_worker_callback(
        WorkerCallbackPayload(
            application_id=current.id,
            user_id="user-1",
            job_id="job-1",
            event="succeeded",
            extracted=WorkerSuccessPayload(
                job_title="Platform Engineer",
                job_description="Build resilient APIs and queues.",
                company=None,
                job_posting_origin="linkedin",
                extracted_reference_id="123456",
            ),
        )
    )

    assert detail.internal_state == "generation_pending"
    assert detail.duplicate_resolution_status is None

    updated = await service.patch_application(
        user_id="user-1",
        application_id=current.id,
        updates={"company": "Acme"},
    )

    assert updated.application.internal_state == "duplicate_review_required"
    assert updated.duplicate_warning is not None


@pytest.mark.asyncio
async def test_persisted_reference_id_can_drive_duplicate_review_without_url_match():
    service, repository, notifications, _, _, _ = build_service()
    existing = repository.create_application(
        user_id="user-1",
        job_url="https://company.example/jobs/platform-engineer",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=existing.id,
        user_id="user-1",
        updates={
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Build distributed systems for customers.",
            "extracted_reference_id": "req-42",
            "job_posting_origin": "company_website",
        },
    )

    created = repository.create_application(
        user_id="user-1",
        job_url="https://jobs.example.org/openings/platform",
        visible_status="draft",
        internal_state="extraction_pending",
    )
    updated = await service.handle_worker_callback(
        WorkerCallbackPayload(
            application_id=created.id,
            user_id="user-1",
            job_id="job-1",
            event="succeeded",
            extracted=WorkerSuccessPayload(
                job_title="Platform Engineer",
                job_description="Build distributed systems for customers.",
                company="Acme",
                job_posting_origin="company_website",
                extracted_reference_id="REQ-42",
            ),
        )
    )

    assert updated.extracted_reference_id == "REQ-42"
    assert updated.internal_state == "duplicate_review_required"
    assert updated.duplicate_resolution_status == "pending"
    assert notifications.notifications[-1]["notification_type"] == "warning"


@pytest.mark.asyncio
async def test_worker_blocked_failure_persists_failure_details():
    service, repository, notifications, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="draft",
        internal_state="extracting",
    )

    updated = await service.handle_worker_callback(
        WorkerCallbackPayload(
            application_id=created.id,
            user_id="user-1",
            job_id="job-1",
            event="failed",
            failure={
                "message": "This source blocked automated retrieval. Paste the job text or complete manual entry.",
                "terminal_error_code": "blocked_source",
                "failure_details": {
                    "kind": "blocked_source",
                    "provider": "indeed",
                    "reference_id": "9e8afb060bd31117",
                    "blocked_url": "https://www.indeed.com/viewjob?jk=abc123",
                    "detected_at": "2026-04-07T12:11:00+00:00",
                },
            },
        )
    )

    assert updated.internal_state == "manual_entry_required"
    assert updated.failure_reason == "extraction_failed"
    assert updated.extraction_failure_details is not None
    assert updated.extraction_failure_details["kind"] == "blocked_source"
    assert updated.extraction_failure_details["provider"] == "indeed"
    assert notifications.notifications[-1]["action_required"] is True


@pytest.mark.asyncio
async def test_recover_from_source_queues_capture_payload():
    service, repository, notifications, progress_store, queue, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="needs_action",
        internal_state="manual_entry_required",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "failure_reason": "extraction_failed",
            "extraction_failure_details": {
                "kind": "blocked_source",
                "provider": "indeed",
                "reference_id": "9e8afb060bd31117",
                "blocked_url": created.job_url,
                "detected_at": "2026-04-07T12:11:00+00:00",
            },
        },
    )
    notifications.create_notification(
        user_id="user-1",
        application_id=created.id,
        notification_type="error",
        message="Action required.",
        action_required=True,
    )

    detail = await service.recover_from_source(
        user_id="user-1",
        application_id=created.id,
        capture=SourceCapturePayload(
            source_text="Senior Platform Engineer at Acme. Build APIs and queues.",
            source_url=created.job_url,
            page_title="Senior Platform Engineer",
            meta={"og:title": "Senior Platform Engineer"},
            json_ld=[],
            captured_at="2026-04-07T12:13:00+00:00",
        ),
    )

    assert detail.application.internal_state == "extraction_pending"
    assert detail.application.extraction_failure_details is None
    assert queue.enqueued[-1]["source_capture"]["source_text"].startswith("Senior Platform Engineer")
    assert notifications.notifications[-1]["action_required"] is False
    assert (await progress_store.get(created.id)).job_id == "job-1"


@pytest.mark.asyncio
async def test_retry_extraction_restores_manual_entry_when_queue_fails():
    service, repository, notifications, progress_store, _, email = build_service(queue_should_fail=True)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="needs_action",
        internal_state="manual_entry_required",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={"failure_reason": "extraction_failed"},
    )
    notifications.create_notification(
        user_id="user-1",
        application_id=created.id,
        notification_type="error",
        message="Action required.",
        action_required=True,
    )

    detail = await service.retry_extraction(
        user_id="user-1",
        application_id=created.id,
    )

    assert detail.application.internal_state == "manual_entry_required"
    assert detail.application.failure_reason == "extraction_failed"
    assert notifications.notifications[-1]["action_required"] is True
    assert len(email.messages) == 1
    assert (await progress_store.get(created.id)).terminal_error_code == "extraction_failed"


@pytest.mark.asyncio
async def test_duplicate_resolution_requires_pending_duplicate_review_state():
    service, repository, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )

    with pytest.raises(PermissionError) as exc_info:
        await service.resolve_duplicate(
            user_id="user-1",
            application_id=created.id,
            resolution="dismissed",
        )

    assert str(exc_info.value) == "Duplicate resolution is unavailable for this application."


def test_applications_endpoint_requires_authentication():
    client = TestClient(app)
    response = client.get("/api/applications")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."
