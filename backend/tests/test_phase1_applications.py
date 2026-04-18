from __future__ import annotations

import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.api.applications import stream_application_events
from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.db.applications import (
    ApplicationRepository,
    ApplicationListRecord,
    ApplicationRecord,
    DuplicateCandidateRecord,
    MatchedApplicationRecord,
)
from app.db.profiles import get_profile_repository
from app.db.resume_drafts import ResumeDraftRecord
from app.main import app
from app.services import application_manager as application_manager_service
from app.services.application_manager import (
    ApplicationService,
    GenerationCallbackPayload,
    ResumeJudgeCallbackPayload,
    SourceCapturePayload,
    WorkerCallbackPayload,
    WorkerSuccessPayload,
    get_application_service,
)
from app.services.progress import ApplicationEvent, ProgressRecord


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
            job_location_text=None,
            compensation_text=None,
            extracted_reference_id=None,
            job_posting_origin=None,
            job_posting_origin_other_text=None,
            base_resume_id=None,
            base_resume_name=None,
            visible_status=visible_status,
            internal_state=internal_state,
            failure_reason=None,
            extraction_failure_details=None,
            generation_failure_details=None,
            resume_judge_result=None,
            applied=False,
            duplicate_similarity_score=None,
            duplicate_match_fields=None,
            duplicate_resolution_status=None,
            duplicate_matched_application_id=None,
            notes=None,
            full_regeneration_count=0,
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

    def delete_application(self, *, application_id: str, user_id: str) -> None:
        record = self.fetch_application(user_id, application_id)
        if record is None:
            raise LookupError("Application not found.")
        del self.records[application_id]


class FakeProfileRepository:
    def __init__(self) -> None:
        self.extension_connected = False
        self.extension_token_hash: str | None = None
        self.extension_token_created_at: str | None = None
        self.extension_token_last_used_at: str | None = None
        self.name = "Test User"
        self.email = "invite-only@example.com"
        self.phone = "555-0100"
        self.address = "Toronto, ON"
        self.linkedin_url = "https://linkedin.com/in/test-user"
        self.section_preferences = {
            "summary": True,
            "professional_experience": True,
            "education": True,
            "skills": True,
        }
        self.section_order = ["summary", "professional_experience", "education", "skills"]
        self.is_admin = False
        self.is_active = True

    def fetch_profile(self, user_id: str):
        class Profile:
            pass

        profile = Profile()
        profile.name = self.name
        profile.email = self.email
        profile.phone = self.phone
        profile.address = self.address
        profile.linkedin_url = self.linkedin_url
        profile.section_preferences = self.section_preferences
        profile.section_order = self.section_order
        profile.is_admin = self.is_admin
        profile.is_active = self.is_active

        return profile

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
        self.extraction_results: dict[str, dict[str, Any]] = {}
        self.generation_results: dict[str, dict[str, Any]] = {}
        self.events: dict[str, list[ApplicationEvent]] = {}
        self.subscribers: dict[str, list[asyncio.Queue[ApplicationEvent]]] = {}
        self.subscription_opened = False

    async def get(self, application_id: str) -> Optional[ProgressRecord]:
        return self.progress.get(application_id)

    async def set(self, application_id: str, progress: ProgressRecord, ttl_seconds: int = 86400) -> None:
        self.progress[application_id] = progress
        await self.publish_event(
            application_id,
            ApplicationEvent(event="progress", payload=progress.model_dump(mode="json")),
        )

    async def delete(self, application_id: str) -> None:
        self.progress.pop(application_id, None)
        self.extraction_results.pop(application_id, None)
        self.generation_results.pop(application_id, None)

    async def get_extraction_result(self, application_id: str) -> Optional[dict[str, Any]]:
        return self.extraction_results.get(application_id)

    async def clear_extraction_result(self, application_id: str) -> None:
        self.extraction_results.pop(application_id, None)

    async def get_generation_result(self, application_id: str) -> Optional[dict[str, Any]]:
        return self.generation_results.get(application_id)

    async def consume_generation_result(self, application_id: str) -> Optional[dict[str, Any]]:
        return self.generation_results.pop(application_id, None)

    async def clear_generation_result(self, application_id: str) -> None:
        self.generation_results.pop(application_id, None)

    async def publish_event(self, application_id: str, event: ApplicationEvent) -> None:
        self.events.setdefault(application_id, []).append(event)
        for subscriber in self.subscribers.get(application_id, []):
            subscriber.put_nowait(event)

    async def open_event_subscription(self, application_id: str):
        queue: asyncio.Queue[ApplicationEvent] = asyncio.Queue()
        self.subscribers.setdefault(application_id, []).append(queue)
        self.subscription_opened = True
        return queue

    async def read_event(self, subscription, *, timeout_seconds: float = 1.0) -> Optional[ApplicationEvent]:
        try:
            return await asyncio.wait_for(subscription.get(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            return None

    async def close_event_subscription(self, application_id: str, subscription) -> None:
        subscribers = self.subscribers.get(application_id, [])
        if subscription in subscribers:
            subscribers.remove(subscription)
        self.subscription_opened = False


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


class FakeDraftRepository:
    def __init__(self) -> None:
        self.drafts: dict[str, ResumeDraftRecord] = {}

    def fetch_draft(self, user_id: str, application_id: str) -> Optional[ResumeDraftRecord]:
        draft = self.drafts.get(application_id)
        if draft and draft.user_id == user_id:
            return draft
        return None

    def upsert_draft(
        self,
        *,
        application_id: str,
        user_id: str,
        content_md: str,
        generation_params: dict[str, Any],
        sections_snapshot: dict[str, Any],
    ) -> ResumeDraftRecord:
        draft = ResumeDraftRecord(
            id=f"draft-{application_id}",
            application_id=application_id,
            user_id=user_id,
            content_md=content_md,
            generation_params=generation_params,
            sections_snapshot=sections_snapshot,
            last_generated_at="2026-04-07T12:10:00+00:00",
            last_exported_at=None,
            updated_at="2026-04-07T12:10:00+00:00",
        )
        self.drafts[application_id] = draft
        return draft

    def update_draft_content(
        self,
        *,
        application_id: str,
        user_id: str,
        content_md: str,
    ) -> ResumeDraftRecord:
        draft = self.fetch_draft(user_id, application_id)
        if draft is None:
            raise LookupError("Resume draft not found.")
        updated = draft.model_copy(
            update={
                "content_md": content_md,
                "updated_at": "2026-04-07T12:11:00+00:00",
            }
        )
        self.drafts[application_id] = updated
        return updated

    def update_exported_at(self, *, application_id: str, user_id: str) -> None:
        draft = self.fetch_draft(user_id, application_id)
        if draft is None:
            raise LookupError("Resume draft not found.")
        self.drafts[application_id] = draft.model_copy(update={"last_exported_at": "2026-04-07T12:12:00+00:00"})


class FakeBaseResumeRepository:
    def __init__(self) -> None:
        self.resumes: dict[str, Any] = {}

    def add_resume(self, *, user_id: str, resume_id: str, content_md: str) -> None:
        self.resumes[resume_id] = type(
            "Resume",
            (),
            {
                "id": resume_id,
                "user_id": user_id,
                "name": "Base Resume",
                "content_md": content_md,
            },
        )()

    def fetch_resume(self, user_id: str, resume_id: str):
        resume = self.resumes.get(resume_id)
        if resume is None or resume.user_id != user_id:
            return None
        return resume


class FakeGenerationJobQueue:
    def __init__(self) -> None:
        self.enqueued: list[dict[str, Any]] = []
        self.regenerations: list[dict[str, Any]] = []
        self.judge_jobs: list[dict[str, Any]] = []

    async def enqueue(self, **kwargs) -> str:
        self.enqueued.append(kwargs)
        return f"gen-job-{len(self.enqueued)}"

    async def enqueue_regeneration(self, **kwargs) -> str:
        self.regenerations.append(kwargs)
        return f"regen-job-{len(self.regenerations)}"

    async def enqueue_resume_judge(self, **kwargs) -> str:
        self.judge_jobs.append(kwargs)
        return f"judge-job-{len(self.judge_jobs)}"


class StubVerifier(AuthVerifier):
    def __init__(self) -> None:
        pass

    def verify_token(self, token: str) -> AuthenticatedUser:
        if token != "valid-token":
            raise HTTPException(status_code=401, detail="Invalid Supabase access token.")

        return AuthenticatedUser(
            id="user-1",
            email="invite-only@example.com",
            role="authenticated",
            claims={"sub": "user-1"},
        )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    app.dependency_overrides[get_profile_repository] = lambda: FakeProfileRepository()
    yield
    app.dependency_overrides = original


def build_service(
    *,
    queue_should_fail: bool = False,
    draft_repository: Optional[FakeDraftRepository] = None,
) -> tuple[
    ApplicationService,
    FakeApplicationRepository,
    FakeNotificationRepository,
    FakeProgressStore,
    FakeExtractionJobQueue,
    FakeEmailSender,
    FakeDraftRepository,
]:
    repository = FakeApplicationRepository()
    notifications = FakeNotificationRepository()
    progress = FakeProgressStore()
    queue = FakeExtractionJobQueue(should_fail=queue_should_fail)
    email = FakeEmailSender()
    profiles = FakeProfileRepository()
    drafts = draft_repository or FakeDraftRepository()
    base_resumes = FakeBaseResumeRepository()
    generation_queue = FakeGenerationJobQueue()
    service = ApplicationService(
        repository=repository,
        base_resume_repository=base_resumes,
        draft_repository=drafts,
        profile_repository=profiles,
        notification_repository=notifications,
        progress_store=progress,
        extraction_job_queue=queue,
        generation_job_queue=generation_queue,
        email_sender=email,
        settings=type(
            "Settings",
            (),
            {"duplicate_similarity_threshold": 85.0, "app_url": "http://localhost:5173"},
        )(),
    )
    return service, repository, notifications, progress, queue, email, drafts


def read_first_sse_event(response) -> tuple[str, dict[str, Any]]:
    event_name = "message"
    data_lines: list[str] = []

    for line in response.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line == "":
            break
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())

    return event_name, json.loads("\n".join(data_lines))


def test_application_repository_prepare_value_wraps_resume_judge_result_as_jsonb():
    repository = ApplicationRepository("postgresql://unused")

    prepared = repository._prepare_value("resume_judge_result", {"status": "queued"})

    assert isinstance(prepared, Jsonb)


@pytest.mark.asyncio
async def test_create_application_queues_extraction_and_seeds_progress():
    service, _, _, progress_store, queue, _, _ = build_service()

    record = await service.create_application(user_id="user-1", job_url="https://example.com/jobs/1")

    assert record.internal_state == "extraction_pending"
    assert queue.enqueued[0]["application_id"] == record.id
    assert (await progress_store.get(record.id)) is not None
    assert (await progress_store.get(record.id)).job_id == "job-1"
    assert progress_store.events[record.id][-1].event == "progress"
    assert progress_store.events[record.id][-1].payload["state"] == "extraction_pending"


@pytest.mark.asyncio
async def test_create_application_falls_back_to_manual_entry_when_queue_fails():
    service, _, notifications, progress_store, _, email, _ = build_service(queue_should_fail=True)

    record = await service.create_application(user_id="user-1", job_url="https://example.com/jobs/1")

    assert record.internal_state == "manual_entry_required"
    assert record.failure_reason == "extraction_failed"
    assert notifications.notifications[-1]["action_required"] is True
    assert len(email.messages) == 1
    assert (await progress_store.get(record.id)).terminal_error_code == "extraction_failed"


@pytest.mark.asyncio
async def test_create_application_from_capture_queues_extraction_with_source_text():
    service, _, _, progress_store, queue, _, _ = build_service()

    record = await service.create_application_from_capture(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        capture=SourceCapturePayload(
            source_text="Senior Platform Engineer. Build APIs and queues.",
            source_url="https://example.com/jobs/1",
        ),
    )

    assert record.internal_state == "extraction_pending"
    assert queue.enqueued[0]["application_id"] == record.id
    assert queue.enqueued[0]["source_capture"]["source_text"] == "Senior Platform Engineer. Build APIs and queues."
    assert queue.enqueued[0]["source_capture"]["source_url"] == "https://example.com/jobs/1"
    assert (await progress_store.get(record.id)) is not None
    assert (await progress_store.get(record.id)).job_id == "job-1"


@pytest.mark.asyncio
async def test_get_draft_with_review_flags_marks_medium_jd_only_additions():
    service, repository, _, _, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "base_resume_id": "resume-1",
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Build backend systems with Kubernetes, Terraform, and CI/CD pipelines.",
        },
    )
    service.base_resume_repository.add_resume(  # type: ignore[attr-defined]
        user_id="user-1",
        resume_id="resume-1",
        content_md=(
            "## Summary\nBuilt backend services.\n\n"
            "## Skills\n- Python\n- FastAPI\n"
        ),
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md=(
            "## Summary\nBuilt backend services with Kubernetes and Terraform.\n\n"
            "## Skills\n- Python\n- FastAPI\n- Kubernetes\n"
        ),
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={
            "enabled_sections": ["summary", "professional_experience", "education", "skills"],
            "section_order": ["summary", "professional_experience", "education", "skills"],
        },
    )

    _draft, review_flags = await service.get_draft_with_review_flags(
        user_id="user-1",
        application_id=created.id,
    )

    assert len(review_flags) >= 1
    assert review_flags[0].reason == "job_description_only_addition"
    assert any(flag.section_name in {"summary", "skills"} for flag in review_flags)


@pytest.mark.asyncio
async def test_get_draft_with_review_flags_marks_professional_experience_title_rewrites():
    service, repository, _, _, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "base_resume_id": "resume-1",
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Platform Engineer role focused on Kubernetes, Terraform, and CI/CD pipelines.",
        },
    )
    service.base_resume_repository.add_resume(  # type: ignore[attr-defined]
        user_id="user-1",
        resume_id="resume-1",
        content_md=(
            "## Professional Experience\n"
            "Backend Engineer | Acme | 2022 - Present\n"
            "- Built backend services.\n"
        ),
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md=(
            "## Professional Experience\n"
            "Platform Engineer | Acme | 2022 - Present\n"
            "- Built backend services with Kubernetes and Terraform.\n"
        ),
        generation_params={"page_length": "1_page", "aggressiveness": "high"},
        sections_snapshot={
            "enabled_sections": ["summary", "professional_experience", "education", "skills"],
            "section_order": ["summary", "professional_experience", "education", "skills"],
        },
    )

    _draft, review_flags = await service.get_draft_with_review_flags(
        user_id="user-1",
        application_id=created.id,
    )

    assert any(
        flag.section_name == "professional_experience"
        and "Platform Engineer | Acme | 2022 - Present" in flag.text
        for flag in review_flags
    )


@pytest.mark.asyncio
async def test_get_draft_with_review_flags_returns_empty_for_low_aggressiveness():
    service, repository, _, _, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "base_resume_id": "resume-1",
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Build backend systems with Kubernetes and Terraform.",
        },
    )
    service.base_resume_repository.add_resume(  # type: ignore[attr-defined]
        user_id="user-1",
        resume_id="resume-1",
        content_md=(
            "## Summary\nBuilt backend services.\n\n"
            "## Skills\n- Python\n- FastAPI\n"
        ),
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md=(
            "## Summary\nBuilt backend services with Kubernetes and Terraform.\n\n"
            "## Skills\n- Python\n- FastAPI\n- Kubernetes\n"
        ),
        generation_params={"page_length": "1_page", "aggressiveness": "low"},
        sections_snapshot={
            "enabled_sections": ["summary", "professional_experience", "education", "skills"],
            "section_order": ["summary", "professional_experience", "education", "skills"],
        },
    )

    _draft, review_flags = await service.get_draft_with_review_flags(
        user_id="user-1",
        application_id=created.id,
    )

    assert review_flags == []


@pytest.mark.asyncio
async def test_get_draft_with_review_flags_uses_generation_base_resume_id_when_selection_changes():
    service, repository, _, _, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "base_resume_id": "resume-2",
            "job_title": "Platform Engineer",
            "company": "Acme",
            "job_description": "Build backend systems with Kubernetes and Terraform.",
        },
    )
    service.base_resume_repository.add_resume(  # type: ignore[attr-defined]
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt backend services with Kubernetes.\n",
    )
    service.base_resume_repository.add_resume(  # type: ignore[attr-defined]
        user_id="user-1",
        resume_id="resume-2",
        content_md="## Summary\nBuilt backend services.\n",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nBuilt backend services with Kubernetes.\n",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
        },
        sections_snapshot={
            "enabled_sections": ["summary", "professional_experience", "education", "skills"],
            "section_order": ["summary", "professional_experience", "education", "skills"],
        },
    )

    _draft, review_flags = await service.get_draft_with_review_flags(
        user_id="user-1",
        application_id=created.id,
    )

    assert review_flags == []


@pytest.mark.asyncio
async def test_manual_entry_with_duplicate_candidate_marks_duplicate_review_required():
    service, repository, notifications, _, _, _, _ = build_service()
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
            "job_location_text": "British Columbia/Ontario",
            "compensation_text": "$150,000 - $180,000",
            "job_posting_origin": "linkedin",
            "job_posting_origin_other_text": None,
            "notes": None,
        },
    )

    assert detail.application.internal_state == "duplicate_review_required"
    assert detail.application.duplicate_resolution_status == "pending"
    assert detail.application.job_location_text == "British Columbia/Ontario"
    assert detail.application.compensation_text == "$150,000 - $180,000"
    assert detail.duplicate_warning is not None
    assert notifications.notifications[-1]["notification_type"] == "warning"


@pytest.mark.asyncio
async def test_patching_manual_entry_fields_keeps_manual_entry_state_until_submit():
    service, repository, _, _, _, _, _ = build_service()
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
    service, repository, _, _, _, _, _ = build_service()
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
    service, repository, notifications, _, _, _, _ = build_service()
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
                job_location_text="British Columbia/Ontario",
                compensation_text="$140,000 - $170,000 base salary",
                job_posting_origin="company_website",
                extracted_reference_id="REQ-42",
            ),
        )
    )

    assert updated.extracted_reference_id == "REQ-42"
    assert updated.job_location_text == "British Columbia/Ontario"
    assert updated.compensation_text == "$140,000 - $170,000 base salary"
    assert updated.internal_state == "duplicate_review_required"
    assert updated.duplicate_resolution_status == "pending"
    assert notifications.notifications[-1]["notification_type"] == "warning"


@pytest.mark.asyncio
async def test_patching_compensation_text_does_not_trigger_duplicate_recheck():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs for customers.",
        },
    )

    updated = await service.patch_application(
        user_id="user-1",
        application_id=created.id,
        updates={"compensation_text": "$120,000 - $145,000"},
    )

    assert updated.application.compensation_text == "$120,000 - $145,000"
    assert updated.application.internal_state == "generation_pending"
    assert updated.application.duplicate_resolution_status is None


@pytest.mark.asyncio
async def test_patching_job_location_text_does_not_trigger_duplicate_recheck():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs for customers.",
        },
    )

    updated = await service.patch_application(
        user_id="user-1",
        application_id=created.id,
        updates={"job_location_text": "British Columbia/Ontario"},
    )

    assert updated.application.job_location_text == "British Columbia/Ontario"
    assert updated.application.internal_state == "generation_pending"
    assert updated.application.duplicate_resolution_status is None


@pytest.mark.asyncio
async def test_worker_blocked_failure_persists_failure_details():
    service, repository, notifications, _, _, _, _ = build_service()
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
    service, repository, notifications, progress_store, queue, _, _ = build_service()
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
    service, repository, notifications, progress_store, _, email, _ = build_service(queue_should_fail=True)
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
    service, repository, _, _, _, _, _ = build_service()
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


@pytest.mark.asyncio
async def test_delete_application_removes_record_and_progress():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="extraction",
            state="generation_pending",
            message="Ready for generation.",
            percent_complete=100,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            completed_at="2026-04-07T12:00:00+00:00",
            terminal_error_code=None,
        ),
    )

    await service.delete_application(user_id="user-1", application_id=created.id)

    assert repository.fetch_application("user-1", created.id) is None
    assert await progress_store.get(created.id) is None


@pytest.mark.asyncio
async def test_delete_application_reconciles_terminal_extraction_before_delete():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="extracting",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="extraction",
            state="manual_entry_required",
            message="Extraction failed.",
            percent_complete=100,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:01:00+00:00",
            completed_at="2026-04-07T12:01:00+00:00",
            terminal_error_code="extraction_failed",
        ),
    )

    await service.delete_application(user_id="user-1", application_id=created.id)

    assert repository.fetch_application("user-1", created.id) is None
    assert await progress_store.get(created.id) is None


@pytest.mark.asyncio
async def test_delete_application_reconciles_terminal_generation_before_delete():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generating",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="generation",
            state="resume_ready",
            message="Resume generated.",
            percent_complete=100,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:01:00+00:00",
            completed_at="2026-04-07T12:01:00+00:00",
            terminal_error_code=None,
        ),
    )

    await service.delete_application(user_id="user-1", application_id=created.id)

    assert repository.fetch_application("user-1", created.id) is None
    assert await progress_store.get(created.id) is None


@pytest.mark.asyncio
async def test_delete_application_succeeds_when_progress_store_unavailable():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )

    async def fail_get(application_id: str) -> Optional[ProgressRecord]:
        raise RuntimeError("redis unavailable")

    async def fail_delete(application_id: str) -> None:
        raise RuntimeError("redis unavailable")

    service.progress_store.get = fail_get  # type: ignore[method-assign]
    service.progress_store.delete = fail_delete  # type: ignore[method-assign]

    await service.delete_application(user_id="user-1", application_id=created.id)

    assert repository.fetch_application("user-1", created.id) is None


@pytest.mark.asyncio
async def test_delete_application_still_blocks_active_state_when_progress_unavailable():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="extracting",
    )

    async def fail_get(application_id: str) -> Optional[ProgressRecord]:
        raise RuntimeError("redis unavailable")

    service.progress_store.get = fail_get  # type: ignore[method-assign]

    with pytest.raises(PermissionError) as exc_info:
        await service.delete_application(user_id="user-1", application_id=created.id)

    assert str(exc_info.value) == "Application cannot be deleted while background work is still running."
    assert repository.fetch_application("user-1", created.id) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "internal_state",
    ["extraction_pending", "extracting", "generating", "regenerating_full", "regenerating_section"],
)
async def test_delete_application_blocks_active_async_states(internal_state: str):
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state=internal_state,
    )

    with pytest.raises(PermissionError) as exc_info:
        await service.delete_application(user_id="user-1", application_id=created.id)

    assert str(exc_info.value) == "Application cannot be deleted while background work is still running."
    assert repository.fetch_application("user-1", created.id) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("internal_state", ["extraction_pending", "extracting"])
async def test_cancel_extraction_moves_active_rows_to_manual_entry_required(internal_state: str):
    service, repository, notifications, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/stop",
        visible_status="draft",
        internal_state=internal_state,
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="extraction",
            state=internal_state,
            message="Extraction is running.",
            percent_complete=35,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:01:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    detail = await service.cancel_extraction(user_id="user-1", application_id=created.id)

    assert detail.application.internal_state == "manual_entry_required"
    assert detail.application.failure_reason == "extraction_failed"
    assert detail.application.extraction_failure_details == {
        "kind": "user_cancelled",
        "provider": None,
        "reference_id": None,
        "blocked_url": "https://example.com/jobs/stop",
        "detected_at": detail.application.extraction_failure_details["detected_at"],
    }
    progress = await progress_store.get(created.id)
    assert progress is not None
    assert progress.state == "manual_entry_required"
    assert progress.terminal_error_code == "extraction_failed"
    assert progress.completed_at is not None
    assert progress.job_id != "job-1"
    assert notifications.notifications == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "internal_state",
    ["manual_entry_required", "generation_pending", "generating", "resume_ready"],
)
async def test_cancel_extraction_rejects_non_active_rows(internal_state: str):
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/idle",
        visible_status="draft",
        internal_state=internal_state,
    )

    with pytest.raises(PermissionError) as exc_info:
        await service.cancel_extraction(user_id="user-1", application_id=created.id)

    assert str(exc_info.value) == "No active extraction to stop."


def test_delete_application_endpoint_returns_204_for_owned_idle_record():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.delete(
        f"/api/applications/{created.id}",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 204
    assert repository.fetch_application("user-1", created.id) is None


def test_create_application_endpoint_accepts_optional_source_text_and_queues_capture_extraction():
    service, _, _, _, queue, _, _ = build_service()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/applications",
        headers={"Authorization": "Bearer valid-token"},
        json={
            "job_url": "https://example.com/jobs/1",
            "source_text": "Senior Platform Engineer. Build APIs and queues.",
        },
    )

    assert response.status_code == 201
    assert response.json()["internal_state"] == "extraction_pending"
    assert queue.enqueued[0]["job_url"] == "https://example.com/jobs/1"
    assert queue.enqueued[0]["source_capture"]["source_text"] == "Senior Platform Engineer. Build APIs and queues."
    assert queue.enqueued[0]["source_capture"]["source_url"] == "https://example.com/jobs/1"


def test_application_events_endpoint_rejects_invalid_auth():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/live",
        visible_status="draft",
        internal_state="extracting",
    )
    asyncio.run(
        progress_store.set(
            created.id,
            ProgressRecord(
                job_id="job-live",
                workflow_kind="extraction",
                state="extracting",
                message="Extraction is running.",
                percent_complete=25,
                created_at="2026-04-07T12:00:00+00:00",
                updated_at="2026-04-07T12:01:00+00:00",
            ),
        )
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.get(
        f"/api/applications/{created.id}/events",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401


def test_application_events_endpoint_rejects_cross_user_access():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-2",
        job_url="https://example.com/jobs/private",
        visible_status="draft",
        internal_state="extracting",
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.get(
        f"/api/applications/{created.id}/events",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Application not found."


@pytest.mark.asyncio
async def test_application_events_endpoint_streams_initial_snapshot():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/live",
        visible_status="draft",
        internal_state="extracting",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-live",
            workflow_kind="extraction",
            state="extracting",
            message="Extraction is running.",
            percent_complete=25,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:01:00+00:00",
        ),
    )

    class StubRequest:
        def __init__(self) -> None:
            self.disconnect_checks = 0

        async def is_disconnected(self) -> bool:
            self.disconnect_checks += 1
            return self.disconnect_checks > 1

    response = await stream_application_events(
        application_id=created.id,
        request=StubRequest(),
        current_user=AuthenticatedUser(
            id="user-1",
            email="invite-only@example.com",
            role="authenticated",
            claims={"sub": "user-1"},
        ),
        service=service,
    )

    chunk = await response.body_iterator.__anext__()
    event_name, payload = read_first_sse_event(
        type(
            "StubResponse",
            (),
            {"iter_lines": lambda self: (chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk).splitlines()},
        )()
    )

    assert response.status_code == 200
    assert event_name == "snapshot"
    assert payload["detail"]["id"] == created.id
    assert payload["detail"]["internal_state"] == "extracting"
    assert payload["progress"]["job_id"] == "job-live"
    assert payload["progress"]["state"] == "extracting"


@pytest.mark.asyncio
async def test_application_events_endpoint_subscribes_before_building_snapshot():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/live",
        visible_status="draft",
        internal_state="extracting",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-live",
            workflow_kind="extraction",
            state="extracting",
            message="Extraction is running.",
            percent_complete=25,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:01:00+00:00",
        ),
    )

    detail_subscription_checks: list[bool] = []
    progress_subscription_checks: list[bool] = []
    original_get_application_detail = service.get_application_detail
    original_get_progress = service.get_progress

    async def get_application_detail_after_subscribe(*, user_id: str, application_id: str):
        detail_subscription_checks.append(progress_store.subscription_opened)
        return await original_get_application_detail(user_id=user_id, application_id=application_id)

    async def get_progress_after_subscribe(*, user_id: str, application_id: str):
        progress_subscription_checks.append(progress_store.subscription_opened)
        return await original_get_progress(user_id=user_id, application_id=application_id)

    service.get_application_detail = get_application_detail_after_subscribe
    service.get_progress = get_progress_after_subscribe

    class StubRequest:
        def __init__(self) -> None:
            self.disconnect_checks = 0

        async def is_disconnected(self) -> bool:
            self.disconnect_checks += 1
            return self.disconnect_checks > 1

    response = await stream_application_events(
        application_id=created.id,
        request=StubRequest(),
        current_user=AuthenticatedUser(
            id="user-1",
            email="invite-only@example.com",
            role="authenticated",
            claims={"sub": "user-1"},
        ),
        service=service,
    )

    await response.body_iterator.__anext__()

    assert detail_subscription_checks == [True]
    assert progress_subscription_checks == [True]


def test_delete_application_endpoint_returns_404_for_missing_record():
    service, _, _, _, _, _, _ = build_service()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.delete(
        "/api/applications/missing-app",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Application not found."


def test_export_docx_endpoint_returns_docx_attachment():
    service, repository, _, _, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.get(
        f"/api/applications/{created.id}/export-docx",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert 'filename="' in response.headers["content-disposition"]
    assert response.headers["content-disposition"].endswith('.docx"')


def test_delete_application_endpoint_returns_409_for_active_record():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generating",
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.delete(
        f"/api/applications/{created.id}",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Application cannot be deleted while background work is still running."


def test_cancel_extraction_endpoint_returns_200_for_owned_active_record():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/stop",
        visible_status="draft",
        internal_state="extracting",
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    import asyncio

    asyncio.run(
        progress_store.set(
            created.id,
            ProgressRecord(
                job_id="job-1",
                workflow_kind="extraction",
                state="extracting",
                message="Extraction is running.",
                percent_complete=50,
                created_at="2026-04-07T12:00:00+00:00",
                updated_at="2026-04-07T12:01:00+00:00",
                completed_at=None,
                terminal_error_code=None,
            ),
        )
    )

    response = client.post(
        f"/api/applications/{created.id}/cancel-extraction",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.json()["internal_state"] == "manual_entry_required"
    assert response.json()["failure_reason"] == "extraction_failed"
    assert response.json()["extraction_failure_details"]["kind"] == "user_cancelled"


def test_cancel_extraction_endpoint_returns_404_for_missing_record():
    service, _, _, _, _, _, _ = build_service()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/applications/missing-app/cancel-extraction",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Application not found."


def test_cancel_extraction_endpoint_returns_409_for_idle_record():
    service, repository, _, _, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/idle",
        visible_status="draft",
        internal_state="generation_pending",
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        f"/api/applications/{created.id}/cancel-extraction",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "No active extraction to stop."


def test_full_regeneration_endpoint_returns_409_when_limit_is_reached():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/cap-endpoint",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
            "full_regeneration_count": 3,
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        f"/api/applications/{created.id}/regenerate",
        headers={"Authorization": "Bearer valid-token"},
        json={
            "target_length": "1_page",
            "aggressiveness": "medium",
            "additional_instructions": None,
        },
    )

    assert response.status_code == 409
    assert "Please contact an administrator" in response.json()["detail"]


def test_resume_judge_endpoint_returns_202_and_queues_re_evaluation():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt reliable APIs.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-endpoint",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
        },
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_application_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        f"/api/applications/{created.id}/judge",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 202
    assert response.json()["resume_judge_result"]["status"] == "queued"
    assert len(service.generation_job_queue.judge_jobs) == 1


@pytest.mark.asyncio
async def test_generation_success_callback_persists_draft_marks_resume_ready_and_queues_resume_judge():
    service, repository, notifications, progress_store, _, _, drafts = build_service()
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt reliable APIs.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generating",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
        },
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="generation",
            state="generating",
            message="Resume generation is running.",
            percent_complete=25,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    updated = await service.handle_generation_callback(
        GenerationCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "job-1",
                "event": "succeeded",
                "generated": {
                    "content_md": "# Resume",
                    "generation_params": {"page_length": "1_page", "aggressiveness": "medium"},
                    "sections_snapshot": {"enabled_sections": ["summary"], "section_order": ["summary"]},
                },
            }
        )
    )

    assert updated.internal_state == "resume_ready"
    assert updated.failure_reason is None
    assert drafts.fetch_draft("user-1", created.id) is not None
    assert drafts.fetch_draft("user-1", created.id).content_md == "# Resume"
    assert updated.resume_judge_result is not None
    assert updated.resume_judge_result["status"] == "queued"
    assert (await progress_store.get(created.id)).state == "resume_ready"
    assert notifications.notifications[-1]["notification_type"] == "success"
    assert len(service.generation_job_queue.judge_jobs) == 1
    assert service.generation_job_queue.judge_jobs[0]["generated_resume_content"] == "# Resume"


@pytest.mark.asyncio
async def test_regeneration_success_callback_queues_resume_judge_for_updated_full_draft():
    drafts = FakeDraftRepository()
    service, repository, notifications, progress_store, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt reliable APIs.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/section-regen",
        visible_status="in_progress",
        internal_state="regenerating_section",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Old Resume",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
        },
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-regen-1",
            workflow_kind="regeneration_section",
            state="regenerating_section",
            message="Section regeneration is running.",
            percent_complete=50,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:05:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    updated = await service.handle_regeneration_callback(
        application_manager_service.RegenerationCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "job-regen-1",
                "event": "succeeded",
                "regeneration_target": "section",
                "generated": {
                    "content_md": "# New Resume\n\n## Summary\nSharper section output.\n",
                    "generation_params": {
                        "page_length": "1_page",
                        "aggressiveness": "medium",
                        "base_resume_id": "resume-1",
                    },
                    "sections_snapshot": {
                        "enabled_sections": ["summary"],
                        "section_order": ["summary"],
                    },
                },
            }
        )
    )

    assert updated.internal_state == "resume_ready"
    assert updated.resume_judge_result is not None
    assert updated.resume_judge_result["status"] == "queued"
    assert drafts.fetch_draft("user-1", created.id).content_md.startswith("# New Resume")
    assert len(service.generation_job_queue.judge_jobs) == 1
    assert service.generation_job_queue.judge_jobs[0]["generated_resume_content"].startswith("# New Resume")
    assert notifications.notifications[-1]["notification_type"] == "success"


@pytest.mark.asyncio
async def test_trigger_resume_judge_queues_manual_re_evaluation():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt reliable APIs.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
            "resume_judge_result": {
                "status": "succeeded",
                "display_score": 82,
                "evaluated_draft_updated_at": "2026-04-07T12:09:00+00:00",
            },
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
        },
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.trigger_resume_judge(user_id="user-1", application_id=created.id)

    assert detail.application.resume_judge_result is not None
    assert detail.application.resume_judge_result["status"] == "queued"
    assert detail.application.resume_judge_result["run_attempt_count"] == 1
    assert len(service.generation_job_queue.judge_jobs) == 1
    assert service.generation_job_queue.judge_jobs[0]["application_id"] == created.id


@pytest.mark.asyncio
async def test_trigger_resume_judge_limits_manual_re_evaluation_to_three_runs_per_draft():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nBuilt reliable APIs.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-limit",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
        },
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    for expected_count in (1, 2, 3):
        detail = await service.trigger_resume_judge(user_id="user-1", application_id=created.id)
        assert detail.application.resume_judge_result is not None
        assert detail.application.resume_judge_result["run_attempt_count"] == expected_count

    with pytest.raises(PermissionError, match="maximum of 3 attempts"):
        await service.trigger_resume_judge(user_id="user-1", application_id=created.id)

    assert len(service.generation_job_queue.judge_jobs) == 3


@pytest.mark.asyncio
async def test_trigger_resume_judge_uses_generation_time_base_resume_snapshot():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nCurrent live base resume.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-snapshot",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "job_description": "Build APIs",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={
            "page_length": "1_page",
            "aggressiveness": "medium",
            "base_resume_id": "resume-1",
            "_base_resume_snapshot_content": "## Summary\nGeneration-time base resume.\n",
        },
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    await service.trigger_resume_judge(user_id="user-1", application_id=created.id)

    assert len(service.generation_job_queue.judge_jobs) == 1
    assert (
        service.generation_job_queue.judge_jobs[0]["base_resume_content"]
        == "## Summary\nGeneration-time base resume.\n"
    )


@pytest.mark.asyncio
async def test_patch_application_invalidates_resume_judge_when_job_details_change():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-invalidated",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs",
            "resume_judge_result": {
                "status": "succeeded",
                "display_score": 83,
                "evaluated_draft_updated_at": "2026-04-07T12:10:00+00:00",
                "job_context_signature": "backend engineer\x1facme\x1fbuild apis",
            },
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.patch_application(
        user_id="user-1",
        application_id=created.id,
        updates={"job_description": "Build distributed APIs"},
    )

    assert detail.application.resume_judge_result is not None
    assert detail.application.resume_judge_result["status"] == "failed"
    assert detail.application.resume_judge_result["failure_stage"] == "stale_job_context"


@pytest.mark.asyncio
async def test_handle_resume_judge_callback_ignores_stale_results():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-stale",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    updated = await service.handle_resume_judge_callback(
        ResumeJudgeCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "judge-job-1",
                "event": "succeeded",
                "evaluated_draft_updated_at": "2026-04-07T12:00:00+00:00",
                "result": {
                    "status": "succeeded",
                    "final_score": 81.2,
                    "display_score": 81,
                    "verdict": "pass",
                    "pass_threshold": 80,
                    "score_summary": "Strong fit.",
                    "dimension_scores": {
                        "role_alignment": {"score": 8, "weight": 0.25, "weighted_contribution": 20.0, "notes": "Aligned."},
                        "specificity_and_concreteness": {"score": 8, "weight": 0.2, "weighted_contribution": 16.0, "notes": "Specific."},
                        "voice_and_human_quality": {"score": 8, "weight": 0.2, "weighted_contribution": 16.0, "notes": "Natural."},
                        "grounding_integrity": {"score": 8, "weight": 0.2, "weighted_contribution": 16.0, "notes": "Grounded."},
                        "ats_safety_and_formatting": {"score": 8, "weight": 0.1, "weighted_contribution": 8.0, "notes": "Clean."},
                        "length_and_density": {"score": 5, "weight": 0.05, "weighted_contribution": 2.5, "notes": "Dense enough."},
                    },
                    "regeneration_instructions": None,
                    "regeneration_priority_dimensions": [],
                    "evaluator_notes": "Solid draft.",
                    "evaluated_draft_updated_at": "2026-04-07T12:00:00+00:00",
                    "scored_at": "2026-04-07T12:12:00+00:00",
                },
            }
        )
    )

    assert updated.resume_judge_result is None


@pytest.mark.asyncio
async def test_handle_resume_judge_callback_ignores_job_context_mismatch():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-mismatch",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build distributed APIs",
            "resume_judge_result": {
                "status": "failed",
                "message": "Resume Judge needs another run because the job details changed.",
                "evaluated_draft_updated_at": "2026-04-07T12:10:00+00:00",
                "job_context_signature": "backend engineer\x1facme\x1fbuild distributed apis",
                "failure_stage": "stale_job_context",
            },
        },
    )
    draft = drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    updated = await service.handle_resume_judge_callback(
        ResumeJudgeCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "judge-job-3",
                "event": "started",
                "evaluated_draft_updated_at": draft.updated_at,
                "job_context_signature": "backend engineer\x1facme\x1fbuild apis",
            }
        )
    )

    assert updated.resume_judge_result is not None
    assert updated.resume_judge_result["failure_stage"] == "stale_job_context"


@pytest.mark.asyncio
async def test_handle_resume_judge_callback_persists_running_success_and_failure_states():
    drafts = FakeDraftRepository()
    service, repository, _, progress_store, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/judge-fresh",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    draft = drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Resume",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "resume_judge_result": {
                "status": "queued",
                "message": "Resume Judge is queued.",
                "evaluated_draft_updated_at": draft.updated_at,
                "run_attempt_count": 2,
            },
        },
    )

    running = await service.handle_resume_judge_callback(
        ResumeJudgeCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "judge-job-2",
                "event": "started",
                "evaluated_draft_updated_at": draft.updated_at,
            }
        )
    )
    assert running.resume_judge_result is not None
    assert running.resume_judge_result["status"] == "running"
    assert running.resume_judge_result["run_attempt_count"] == 2

    succeeded = await service.handle_resume_judge_callback(
        ResumeJudgeCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "judge-job-2",
                "event": "succeeded",
                "evaluated_draft_updated_at": draft.updated_at,
                "result": {
                    "status": "succeeded",
                    "final_score": 76.5,
                    "display_score": 77,
                    "verdict": "warn",
                    "pass_threshold": 80,
                    "score_summary": "Good fit with cleanup needed.",
                    "dimension_scores": {
                        "role_alignment": {"score": 8, "weight": 0.25, "weighted_contribution": 20.0, "notes": "Aligned."},
                        "specificity_and_concreteness": {"score": 7, "weight": 0.2, "weighted_contribution": 14.0, "notes": "Mostly specific."},
                        "voice_and_human_quality": {"score": 6, "weight": 0.2, "weighted_contribution": 12.0, "notes": "Template-ish."},
                        "grounding_integrity": {"score": 8, "weight": 0.2, "weighted_contribution": 16.0, "notes": "Grounded."},
                        "ats_safety_and_formatting": {"score": 9, "weight": 0.1, "weighted_contribution": 9.0, "notes": "ATS safe."},
                        "length_and_density": {"score": 5, "weight": 0.05, "weighted_contribution": 2.5, "notes": "Slightly long."},
                    },
                    "regeneration_instructions": "Tighten voice and density.",
                    "regeneration_priority_dimensions": ["voice_and_human_quality", "length_and_density"],
                    "evaluator_notes": "Mostly solid.",
                    "evaluated_draft_updated_at": draft.updated_at,
                    "scored_at": "2026-04-07T12:12:00+00:00",
                },
            }
        )
    )
    assert succeeded.resume_judge_result is not None
    assert succeeded.resume_judge_result["status"] == "succeeded"
    assert succeeded.resume_judge_result["display_score"] == 77
    assert succeeded.resume_judge_result["run_attempt_count"] == 2

    failed = await service.handle_resume_judge_callback(
        ResumeJudgeCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "judge-job-2",
                "event": "failed",
                "evaluated_draft_updated_at": draft.updated_at,
                "failure": {
                    "message": "Resume Judge failed. Score unavailable.",
                    "result": {
                        "status": "failed",
                        "message": "Resume Judge failed. Score unavailable.",
                        "evaluated_draft_updated_at": draft.updated_at,
                        "scored_at": "2026-04-07T12:13:00+00:00",
                        "failure_stage": "provider",
                        "attempt_count": 2,
                        "attempts": [
                            {"model": "primary", "outcome": "provider_error"},
                            {"model": "fallback", "outcome": "provider_error"},
                        ],
                        "error": {"error_type": "RuntimeError", "message": "provider failed"},
                    },
                },
            }
        )
    )
    assert failed.resume_judge_result is not None
    assert failed.resume_judge_result["status"] == "failed"
    assert failed.resume_judge_result["failure_stage"] == "provider"
    assert failed.resume_judge_result["run_attempt_count"] == 2
    detail_events = [event for event in progress_store.events[created.id] if event.event == "detail"]
    assert [event.payload["resume_judge_result"]["status"] for event in detail_events[-3:]] == ["running", "succeeded", "failed"]


@pytest.mark.asyncio
async def test_trigger_generation_routes_blocked_placeholder_back_to_manual_entry():
    service, repository, notifications, _, _, _, _ = build_service()
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Blocked - Indeed.com",
            "job_description": (
                "Indeed page showing a request blocked notice. "
                "You have been blocked. Your Ray ID for this request is 9e8afb060bd31117."
            ),
            "job_posting_origin": "indeed",
        },
    )

    detail = await service.trigger_generation(
        user_id="user-1",
        application_id=created.id,
        base_resume_id="resume-1",
        target_length="1_page",
        aggressiveness="low",
        additional_instructions=None,
    )

    assert detail.application.internal_state == "manual_entry_required"
    assert detail.application.failure_reason == "extraction_failed"
    assert detail.application.extraction_failure_details is not None
    assert detail.application.extraction_failure_details["kind"] == "blocked_source"
    assert detail.application.extraction_failure_details["provider"] == "indeed"
    assert notifications.notifications[-1]["action_required"] is True
    assert service.generation_job_queue.enqueued == []


@pytest.mark.asyncio
async def test_full_regeneration_routes_blocked_placeholder_back_to_manual_entry():
    drafts = FakeDraftRepository()
    service, repository, notifications, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Blocked - Indeed.com",
            "job_description": "You have been blocked. Please go to support.indeed.com for help.",
            "job_posting_origin": "indeed",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft",
        generation_params={"page_length": "1_page", "aggressiveness": "low"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.trigger_full_regeneration(
        user_id="user-1",
        application_id=created.id,
        target_length="1_page",
        aggressiveness="low",
        additional_instructions=None,
    )

    assert detail.application.internal_state == "manual_entry_required"
    assert detail.application.failure_reason == "extraction_failed"
    assert detail.application.extraction_failure_details is not None
    assert detail.application.extraction_failure_details["kind"] == "blocked_source"
    assert notifications.notifications[-1]["action_required"] is True
    assert service.generation_job_queue.regenerations == []


@pytest.mark.asyncio
async def test_trigger_generation_requires_profile_name():
    service, repository, _, _, _, _, _ = build_service()
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
        },
    )
    service.profile_repository.name = None

    with pytest.raises(ValueError, match="Complete your profile name before generating a resume."):
        await service.trigger_generation(
            user_id="user-1",
            application_id=created.id,
            base_resume_id="resume-1",
            target_length="1_page",
            aggressiveness="medium",
            additional_instructions=None,
        )

    assert service.generation_job_queue.enqueued == []


@pytest.mark.asyncio
async def test_full_regeneration_requires_profile_name():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Test User\ninvite-only@example.com | 555-0100 | Toronto, ON\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    service.profile_repository.name = None

    with pytest.raises(ValueError, match="Complete your profile name before regenerating the full resume."):
        await service.trigger_full_regeneration(
            user_id="user-1",
            application_id=created.id,
            target_length="1_page",
            aggressiveness="medium",
            additional_instructions=None,
        )

    assert service.generation_job_queue.regenerations == []


@pytest.mark.asyncio
async def test_full_regeneration_consumes_slot_for_non_admin_when_queued():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/slot",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
            "full_regeneration_count": 1,
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Test User\ninvite-only@example.com | 555-0100 | Toronto, ON\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.trigger_full_regeneration(
        user_id="user-1",
        application_id=created.id,
        target_length="1_page",
        aggressiveness="medium",
        additional_instructions=None,
    )

    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert detail.application.internal_state == "regenerating_full"
    assert updated.full_regeneration_count == 2
    assert len(service.generation_job_queue.regenerations) == 1


@pytest.mark.asyncio
async def test_full_regeneration_blocks_non_admin_after_limit_reached():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/cap",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
            "full_regeneration_count": 3,
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    with pytest.raises(
        PermissionError,
        match="You have reached the full regeneration limit for this resume. Please contact an administrator",
    ):
        await service.trigger_full_regeneration(
            user_id="user-1",
            application_id=created.id,
            target_length="1_page",
            aggressiveness="medium",
            additional_instructions=None,
        )

    assert len(service.generation_job_queue.regenerations) == 0


@pytest.mark.asyncio
async def test_full_regeneration_allows_admin_bypass_past_limit():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.profile_repository.is_admin = True
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/admin-bypass",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
            "full_regeneration_count": 3,
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.trigger_full_regeneration(
        user_id="user-1",
        application_id=created.id,
        target_length="1_page",
        aggressiveness="medium",
        additional_instructions=None,
    )

    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert detail.application.internal_state == "regenerating_full"
    assert updated.full_regeneration_count == 3
    assert len(service.generation_job_queue.regenerations) == 1


@pytest.mark.asyncio
async def test_full_regeneration_queue_failure_does_not_consume_slot():
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/queue-failure",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": "Build reliable delivery systems.",
            "base_resume_id": "resume-1",
            "full_regeneration_count": 2,
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft\n\n## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    async def fail_queue(**_kwargs):
        raise RuntimeError("queue unavailable")

    service.generation_job_queue.enqueue_regeneration = fail_queue  # type: ignore[method-assign]

    detail = await service.trigger_full_regeneration(
        user_id="user-1",
        application_id=created.id,
        target_length="1_page",
        aggressiveness="medium",
        additional_instructions=None,
    )

    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert detail.application.failure_reason == "regeneration_failed"
    assert updated.full_regeneration_count == 2


@pytest.mark.asyncio
async def test_export_pdf_requires_profile_name(monkeypatch):
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    service.profile_repository.name = None

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("generate_pdf should not run when profile name is missing")

    monkeypatch.setattr(application_manager_service, "generate_pdf", fail_if_called)

    with pytest.raises(ValueError, match="Complete your profile name before exporting a PDF."):
        await service.export_pdf(
            user_id="user-1",
            application_id=created.id,
        )


@pytest.mark.asyncio
async def test_export_docx_requires_profile_name(monkeypatch):
    drafts = FakeDraftRepository()
    service, repository, _, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )
    service.profile_repository.name = None

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("generate_docx should not run when profile name is missing")

    monkeypatch.setattr(application_manager_service, "generate_docx", fail_if_called)

    with pytest.raises(ValueError, match="Complete your profile name before exporting a DOCX."):
        await service.export_docx(
            user_id="user-1",
            application_id=created.id,
        )


@pytest.mark.asyncio
async def test_export_docx_updates_status_notifications_and_timestamps(monkeypatch):
    drafts = FakeDraftRepository()
    service, repository, notifications, _, _, _, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    async def fake_generate_docx(*args, **kwargs):
        return b"docx-bytes"

    monkeypatch.setattr(application_manager_service, "generate_docx", fake_generate_docx)

    export_bytes, filename = await service.export_docx(
        user_id="user-1",
        application_id=created.id,
    )

    updated = repository.fetch_application("user-1", created.id)
    draft = drafts.fetch_draft("user-1", created.id)

    assert export_bytes == b"docx-bytes"
    assert filename.endswith(".docx")
    assert updated is not None
    assert updated.visible_status == "complete"
    assert updated.exported_at is not None
    assert draft is not None
    assert draft.last_exported_at is not None
    assert notifications.notifications[-1]["message"] == "DOCX export completed successfully."


@pytest.mark.asyncio
async def test_export_docx_failure_sets_export_failed_and_uses_docx_copy(monkeypatch):
    drafts = FakeDraftRepository()
    service, repository, notifications, _, _, email_sender, drafts = build_service(draft_repository=drafts)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="## Summary\nQuality engineer.\n",
        generation_params={"page_length": "1_page", "aggressiveness": "medium"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    async def fail_generate_docx(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(application_manager_service, "generate_docx", fail_generate_docx)

    with pytest.raises(ValueError, match="DOCX export failed."):
        await service.export_docx(
            user_id="user-1",
            application_id=created.id,
        )

    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.failure_reason == "export_failed"
    assert updated.visible_status == "needs_action"
    assert notifications.notifications[-1]["message"] == "DOCX export failed. Please try again."
    assert email_sender.messages[-1].subject == "Applix: DOCX export failed"


@pytest.mark.asyncio
async def test_section_regeneration_routes_blocked_placeholder_back_to_manual_entry():
    drafts = FakeDraftRepository()
    service, repository, notifications, _, _, _, drafts = build_service(draft_repository=drafts)
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="resume-1",
        content_md="## Summary\nQuality engineer.\n",
    )
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="in_progress",
        internal_state="resume_ready",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={
            "job_title": "Quality Engineer",
            "job_description": (
                "Request blocked notice. You have been blocked. "
                "Ray ID for this request is 9e8afb060bd31117."
            ),
            "job_posting_origin": "indeed",
            "base_resume_id": "resume-1",
        },
    )
    drafts.upsert_draft(
        application_id=created.id,
        user_id="user-1",
        content_md="# Draft",
        generation_params={"page_length": "1_page", "aggressiveness": "low"},
        sections_snapshot={"enabled_sections": ["summary"], "section_order": ["summary"]},
    )

    detail = await service.trigger_section_regeneration(
        user_id="user-1",
        application_id=created.id,
        section_name="summary",
        instructions="Tighten it.",
    )

    assert detail.application.internal_state == "manual_entry_required"
    assert detail.application.failure_reason == "extraction_failed"
    assert detail.application.extraction_failure_details is not None
    assert detail.application.extraction_failure_details["kind"] == "blocked_source"
    assert notifications.notifications[-1]["action_required"] is True
    assert service.generation_job_queue.regenerations == []


@pytest.mark.asyncio
async def test_cancel_generation_rejects_retryable_failed_row():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="needs_action",
        internal_state="generation_pending",
    )
    repository.update_application(
        application_id=created.id,
        user_id="user-1",
        updates={"failure_reason": "generation_failed"},
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="generation",
            state="generation_failed",
            message="Generation failed.",
            percent_complete=100,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            completed_at="2026-04-07T12:00:00+00:00",
            terminal_error_code="generation_failed",
        ),
    )

    with pytest.raises(PermissionError) as exc_info:
        await service.cancel_generation(user_id="user-1", application_id=created.id)

    assert str(exc_info.value) == "No active generation to cancel."
    assert notifications.notifications == []


@pytest.mark.asyncio
async def test_cancelled_generation_ignores_stale_success_callback():
    service, repository, _, progress_store, _, _, drafts = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generating",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="generation",
            state="generating",
            message="Resume generation is running.",
            percent_complete=50,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    detail = await service.cancel_generation(user_id="user-1", application_id=created.id)

    assert detail.application.failure_reason == "generation_cancelled"
    cancelled_progress = await progress_store.get(created.id)
    assert cancelled_progress is not None
    assert cancelled_progress.terminal_error_code == "generation_cancelled"
    assert cancelled_progress.job_id != "job-1"

    updated = await service.handle_generation_callback(
        GenerationCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "job-1",
                "event": "succeeded",
                "generated": {
                    "content_md": "# Stale Resume",
                    "generation_params": {"page_length": "1_page", "aggressiveness": "medium"},
                    "sections_snapshot": {"enabled_sections": ["summary"], "section_order": ["summary"]},
                },
            }
        )
    )

    assert updated.failure_reason == "generation_cancelled"


@pytest.mark.asyncio
async def test_cancelled_extraction_ignores_stale_success_callback():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="extracting",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="extraction",
            state="extracting",
            message="Extraction is running.",
            percent_complete=50,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:00:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    detail = await service.cancel_extraction(user_id="user-1", application_id=created.id)

    assert detail.application.failure_reason == "extraction_failed"
    stopped_progress = await progress_store.get(created.id)
    assert stopped_progress is not None
    assert stopped_progress.terminal_error_code == "extraction_failed"
    assert stopped_progress.job_id != "job-1"

    updated = await service.handle_worker_callback(
        WorkerCallbackPayload.model_validate(
            {
                "application_id": created.id,
                "user_id": "user-1",
                "job_id": "job-1",
                "event": "succeeded",
                "extracted": {
                    "job_title": "Stale role",
                    "company": "Stale Co",
                    "job_description": "Stale description",
                },
            }
        )
    )

    assert updated.failure_reason == "extraction_failed"
    assert updated.internal_state == "manual_entry_required"
    assert updated.job_title is None


@pytest.mark.asyncio
async def test_generation_timeout_profiles_match_prd_contract():
    service, repository, _, _, _, _, _ = build_service()

    generation_record = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/full",
        visible_status="draft",
        internal_state="generating",
    )
    section_regen_record = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/section",
        visible_status="draft",
        internal_state="regenerating_section",
    )

    assert service._generation_timeout_seconds(generation_record, None) == (240, 240)
    assert service._generation_timeout_seconds(
        section_regen_record,
        ProgressRecord(
            job_id="job-section",
            workflow_kind="regeneration_section",
            state="regenerating_section",
            message="Section regeneration is running.",
            percent_complete=50,
            created_at="2026-04-14T12:00:00+00:00",
            updated_at="2026-04-14T12:00:05+00:00",
        ),
    ) == (120, 120)


@pytest.mark.asyncio
async def test_stuck_generation_recovery_marks_timeout_and_terminal_progress():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/1",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(
        update={"updated_at": "2026-04-07T10:00:00+00:00"}
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-1",
            workflow_kind="generation",
            state="generating",
            message="Resume generation is running.",
            percent_complete=50,
            created_at="2026-04-07T10:00:00+00:00",
            updated_at="2026-04-07T10:00:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    recovered = await service._detect_and_recover_stuck_generation(repository.records[created.id])

    assert recovered is True
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.failure_reason == "generation_timeout"
    assert updated.internal_state == "generation_pending"
    timeout_progress = await progress_store.get(created.id)
    assert timeout_progress is not None
    assert timeout_progress.terminal_error_code == "generation_timeout"
    assert timeout_progress.job_id != "job-1"


@pytest.mark.asyncio
async def test_get_progress_recovers_stalled_generation_before_returning_progress():
    service, repository, _, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    started_at = (now - timedelta(seconds=320)).isoformat()
    stalled_at = (now - timedelta(seconds=250)).isoformat()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/2",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": stalled_at})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-2",
            workflow_kind="generation",
            state="generating",
            message="Resume generation is running.",
            percent_complete=50,
            created_at=started_at,
            updated_at=stalled_at,
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.terminal_error_code == "generation_timeout"
    assert progress.completed_at is not None
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.failure_reason == "generation_timeout"


@pytest.mark.asyncio
async def test_get_progress_reconciles_terminal_generation_progress_without_timeout_recovery():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/4",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=120)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-4",
            workflow_kind="generation",
            state="generation_failed",
            message="Resume generation failed unexpectedly.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=120)).isoformat(),
            updated_at=(now - timedelta(seconds=110)).isoformat(),
            completed_at=(now - timedelta(seconds=110)).isoformat(),
            terminal_error_code="generation_error",
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.terminal_error_code == "generation_error"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "generation_pending"
    assert updated.failure_reason == "generation_failed"
    assert updated.generation_failure_details == {"message": "Resume generation failed unexpectedly."}
    assert notifications.notifications[-1]["message"] == "Resume generation failed unexpectedly."


@pytest.mark.asyncio
async def test_get_progress_reconciles_terminal_extraction_failure_progress():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://www.indeed.com/viewjob?jk=abc123",
        visible_status="draft",
        internal_state="extracting",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=60)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-7",
            workflow_kind="extraction",
            state="manual_entry_required",
            message="This source blocked automated retrieval. Paste the job text or complete manual entry.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=45)).isoformat(),
            completed_at=(now - timedelta(seconds=45)).isoformat(),
            terminal_error_code="blocked_source",
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.terminal_error_code == "blocked_source"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "manual_entry_required"
    assert updated.failure_reason == "extraction_failed"
    assert updated.extraction_failure_details is not None
    assert updated.extraction_failure_details["kind"] == "blocked_source"
    assert notifications.notifications[-1]["message"].startswith("This source blocked automated retrieval")


@pytest.mark.asyncio
async def test_get_progress_fails_closed_when_extraction_success_progress_has_no_callback_sync():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/7",
        visible_status="draft",
        internal_state="extracting",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=30)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-8",
            workflow_kind="extraction",
            state="generation_pending",
            message="Extraction completed.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.state == "manual_entry_required"
    assert progress.terminal_error_code == "extraction_failed"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "manual_entry_required"
    assert updated.failure_reason == "extraction_failed"
    assert updated.extraction_failure_details is not None
    assert updated.extraction_failure_details["kind"] == "callback_delivery_failed"
    assert "could not be synchronized" in notifications.notifications[-1]["message"].lower()


@pytest.mark.asyncio
async def test_get_progress_recovers_extraction_success_from_cached_result_when_callback_missed():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/8",
        visible_status="draft",
        internal_state="extracting",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=30)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-9",
            workflow_kind="extraction",
            state="generation_pending",
            message="Extraction completed.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )
    progress_store.extraction_results[created.id] = {
        "job_id": "job-9",
        "captured_at": now.isoformat(),
        "extracted": {
            "job_title": "Senior Backend Engineer",
            "job_description": "Build APIs and background systems.",
            "company": "Acme",
            "job_location_text": "Toronto, ON",
            "compensation_text": "$140,000 - $170,000",
            "job_posting_origin": "linkedin",
            "job_posting_origin_other_text": None,
            "extracted_reference_id": "1234567890",
        },
    }

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.state == "generation_pending"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "generation_pending"
    assert updated.failure_reason is None
    assert updated.job_title == "Senior Backend Engineer"
    assert updated.company == "Acme"
    assert created.id not in progress_store.extraction_results
    assert notifications.notifications == []


@pytest.mark.asyncio
async def test_get_application_detail_recovers_extraction_success_from_cached_result_when_callback_missed():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/9",
        visible_status="draft",
        internal_state="extracting",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=30)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-10",
            workflow_kind="extraction",
            state="generation_pending",
            message="Extraction completed.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )
    progress_store.extraction_results[created.id] = {
        "job_id": "job-10",
        "captured_at": now.isoformat(),
        "extracted": {
            "job_title": "Data Modeling and Analytics Architect",
            "job_description": "Design enterprise data models and analytics platforms.",
            "company": "Acme",
            "job_location_text": "Toronto, ON",
            "compensation_text": "$170,000 - $210,000",
            "job_posting_origin": "linkedin",
            "job_posting_origin_other_text": None,
            "extracted_reference_id": "ref-10",
        },
    }

    detail = await service.get_application_detail(user_id="user-1", application_id=created.id)

    assert detail.application.internal_state == "generation_pending"
    assert detail.application.failure_reason is None
    assert detail.application.job_title == "Data Modeling and Analytics Architect"
    assert detail.application.company == "Acme"
    assert created.id not in progress_store.extraction_results
    assert notifications.notifications == []


@pytest.mark.asyncio
async def test_get_progress_recovers_generation_success_from_cached_result_when_callback_missed():
    service, repository, notifications, progress_store, _, _, draft_repository = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/10",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=30)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-11",
            workflow_kind="generation",
            state="resume_ready",
            message="Resume generated.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )
    progress_store.generation_results[created.id] = {
        "job_id": "job-11",
        "workflow_kind": "generation",
        "captured_at": now.isoformat(),
        "generated": {
            "content_md": "# Test Resume",
            "generation_params": {"page_length": "1_page", "aggressiveness": "medium"},
            "sections_snapshot": {
                "enabled_sections": ["summary", "skills"],
                "section_order": ["summary", "skills"],
            },
        },
    }

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.state == "resume_ready"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "resume_ready"
    assert updated.failure_reason is None
    draft = draft_repository.fetch_draft("user-1", created.id)
    assert draft is not None
    assert draft.content_md == "# Test Resume"
    assert created.id not in progress_store.generation_results
    assert notifications.notifications[-1]["notification_type"] == "success"


@pytest.mark.asyncio
async def test_generation_success_cache_recovery_consumes_cached_payload_once_across_concurrent_reads():
    service, repository, _, progress_store, _, _, draft_repository = build_service()
    generation_queue = service.generation_job_queue
    assert isinstance(generation_queue, FakeGenerationJobQueue)
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/11",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(
        update={
            "updated_at": (now - timedelta(seconds=30)).isoformat(),
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": "Build APIs",
            "base_resume_id": "base-1",
        }
    )
    service.base_resume_repository.add_resume(
        user_id="user-1",
        resume_id="base-1",
        content_md="# Base Resume",
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-13",
            workflow_kind="generation",
            state="resume_ready",
            message="Resume generated.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )
    progress_store.generation_results[created.id] = {
        "job_id": "job-13",
        "workflow_kind": "generation",
        "captured_at": now.isoformat(),
        "generated": {
            "content_md": "# Test Resume",
            "generation_params": {
                "page_length": "1_page",
                "aggressiveness": "medium",
                "base_resume_id": "base-1",
            },
            "sections_snapshot": {
                "enabled_sections": ["summary", "skills"],
                "section_order": ["summary", "skills"],
            },
        },
    }

    await asyncio.gather(
        service.get_progress(user_id="user-1", application_id=created.id),
        service.get_application_detail(user_id="user-1", application_id=created.id),
    )

    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.resume_judge_result is not None
    assert updated.resume_judge_result["status"] == "queued"
    assert len(generation_queue.judge_jobs) == 1
    assert created.id not in progress_store.generation_results
    draft = draft_repository.fetch_draft("user-1", created.id)
    assert draft is not None
    assert draft.content_md == "# Test Resume"


@pytest.mark.asyncio
async def test_get_progress_fails_closed_when_generation_success_progress_has_no_callback_sync():
    service, repository, notifications, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/11",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": (now - timedelta(seconds=30)).isoformat()})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-12",
            workflow_kind="generation",
            state="resume_ready",
            message="Resume generated.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=90)).isoformat(),
            updated_at=(now - timedelta(seconds=20)).isoformat(),
            completed_at=(now - timedelta(seconds=20)).isoformat(),
            terminal_error_code=None,
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.state == "generation_pending"
    assert progress.terminal_error_code == "generation_failed"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.internal_state == "generation_pending"
    assert updated.failure_reason == "generation_failed"
    assert updated.generation_failure_details is not None
    assert "could not be synchronized" in updated.generation_failure_details["message"].lower()
    assert notifications.notifications[-1]["notification_type"] == "error"


@pytest.mark.asyncio
async def test_get_progress_prefers_terminal_application_state_over_stale_active_progress():
    service, repository, _, progress_store, _, _, _ = build_service()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/6",
        visible_status="needs_action",
        internal_state="generation_pending",
    )
    repository.records[created.id] = created.model_copy(
        update={
            "failure_reason": "generation_cancelled",
            "generation_failure_details": {"message": "Generation was cancelled by user."},
            "updated_at": "2026-04-07T12:10:00+00:00",
        }
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-6",
            workflow_kind="generation",
            state="generating",
            message="Resume generation is running.",
            percent_complete=40,
            created_at="2026-04-07T12:00:00+00:00",
            updated_at="2026-04-07T12:05:00+00:00",
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.state == "generation_pending"
    assert progress.terminal_error_code == "generation_cancelled"
    assert progress.completed_at == "2026-04-07T12:10:00+00:00"


@pytest.mark.asyncio
async def test_terminal_progress_reconciliation_preserves_existing_validation_errors():
    service, repository, _, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/5",
        visible_status="draft",
        internal_state="generation_pending",
    )
    repository.records[created.id] = created.model_copy(
        update={
            "internal_state": "generation_pending",
            "failure_reason": "generation_failed",
            "generation_failure_details": {
                "message": "Resume validation failed.",
                "validation_errors": ["summary: Invented employer"],
            },
            "updated_at": now.isoformat(),
        }
    )
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-5",
            workflow_kind="generation",
            state="generation_failed",
            message="Resume validation failed.",
            percent_complete=100,
            created_at=(now - timedelta(seconds=5)).isoformat(),
            updated_at=(now - timedelta(seconds=5)).isoformat(),
            completed_at=(now - timedelta(seconds=5)).isoformat(),
            terminal_error_code="generation_failed",
        ),
    )

    progress = await service.get_progress(user_id="user-1", application_id=created.id)

    assert progress.terminal_error_code == "generation_failed"
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.generation_failure_details == {
        "message": "Resume validation failed.",
        "validation_errors": ["summary: Invented employer"],
    }


@pytest.mark.asyncio
async def test_stuck_generation_recovery_waits_when_recent_progress_exists():
    service, repository, _, progress_store, _, _, _ = build_service()
    now = datetime.now(timezone.utc)
    started_at = (now - timedelta(seconds=180)).isoformat()
    recent_progress_at = (now - timedelta(seconds=15)).isoformat()
    created = repository.create_application(
        user_id="user-1",
        job_url="https://example.com/jobs/3",
        visible_status="draft",
        internal_state="generating",
    )
    repository.records[created.id] = created.model_copy(update={"updated_at": recent_progress_at})
    await progress_store.set(
        created.id,
        ProgressRecord(
            job_id="job-3",
            workflow_kind="generation",
            state="generating",
            message="Generated skills section.",
            percent_complete=75,
            created_at=started_at,
            updated_at=recent_progress_at,
            completed_at=None,
            terminal_error_code=None,
        ),
    )

    recovered = await service._detect_and_recover_stuck_generation(repository.records[created.id])

    assert recovered is False
    updated = repository.fetch_application("user-1", created.id)
    assert updated is not None
    assert updated.failure_reason is None


def test_application_repository_wraps_jsonb_update_values():
    repository = ApplicationRepository("postgresql://example")

    wrapped = repository._prepare_value("generation_failure_details", {"message": "failed"})

    assert isinstance(wrapped, Jsonb)
    assert repository._cast_placeholder("generation_failure_details").as_string(None) == "%s::jsonb"


def test_normalize_generation_failure_details_preserves_sanitized_attempt_diagnostics():
    service, _, _, _, _, _, _ = build_service()

    normalized = service._normalize_generation_failure_details(
        message="Resume validation failed.",
        failure_details={
            "failure_stage": "validation",
            "attempt_count": 2,
            "terminal_error_code": "validation_failed",
            "attempts": [
                {
                    "model": "openai/gpt-5-mini",
                    "reasoning_effort": "medium",
                    "transport_mode": "structured",
                    "outcome": "structured_failed",
                    "elapsed_ms": 1200,
                    "retry_reason": "structured_failed",
                    "raw_payload": "should not survive",
                },
                {
                    "model": "google/gemini-flash-1.5",
                    "reasoning_effort": "medium",
                    "transport_mode": "json",
                    "outcome": "success",
                    "elapsed_ms": 980,
                },
            ],
            "repair_error": {"error_type": "RuntimeError", "message": "provider failed", "payload": "drop-me"},
            "validation_errors": ["summary: Missing evidence"],
        },
    )

    assert normalized == {
        "message": "Resume validation failed.",
        "failure_stage": "validation",
        "attempt_count": 2,
        "terminal_error_code": "validation_failed",
        "attempts": [
            {
                "model": "openai/gpt-5-mini",
                "reasoning_effort": "medium",
                "transport_mode": "structured",
                "outcome": "structured_failed",
                "elapsed_ms": 1200,
                "retry_reason": "structured_failed",
            },
            {
                "model": "google/gemini-flash-1.5",
                "reasoning_effort": "medium",
                "transport_mode": "json",
                "outcome": "success",
                "elapsed_ms": 980,
            },
        ],
        "repair_error": {"error_type": "RuntimeError", "message": "provider failed"},
        "validation_errors": ["summary: Missing evidence"],
    }
