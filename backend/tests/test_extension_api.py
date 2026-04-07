from __future__ import annotations

import copy
from typing import Optional

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.db.applications import ApplicationRecord
from app.db.profiles import (
    ExtensionConnectionRecord,
    ExtensionTokenOwnerRecord,
    ProfileRepository,
    get_profile_repository,
)
from app.main import app
from app.services.application_manager import (
    ApplicationDetailPayload,
    ApplicationService,
    get_application_service,
)


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


class StubProfileRepository(ProfileRepository):
    def __init__(self) -> None:
        self.token_hash: Optional[str] = None
        self.token_created_at: Optional[str] = None
        self.token_last_used_at: Optional[str] = None

    def fetch_extension_connection(self, user_id: str) -> Optional[ExtensionConnectionRecord]:
        return ExtensionConnectionRecord(
            connected=self.token_hash is not None,
            token_created_at=self.token_created_at,
            token_last_used_at=self.token_last_used_at,
        )

    def upsert_extension_token(self, *, user_id: str, token_hash: str) -> ExtensionConnectionRecord:
        self.token_hash = token_hash
        self.token_created_at = "2026-04-07T12:00:00+00:00"
        self.token_last_used_at = None
        return self.fetch_extension_connection(user_id)

    def clear_extension_token(self, *, user_id: str) -> ExtensionConnectionRecord:
        self.token_hash = None
        self.token_created_at = None
        self.token_last_used_at = None
        return self.fetch_extension_connection(user_id)

    def fetch_extension_owner_by_token_hash(self, token_hash: str) -> Optional[ExtensionTokenOwnerRecord]:
        if token_hash != self.token_hash:
            return None
        return ExtensionTokenOwnerRecord(id="user-1", email="invite-only@example.com")

    def touch_extension_token(self, *, user_id: str) -> None:
        self.token_last_used_at = "2026-04-07T12:05:00+00:00"


class StubApplicationService(ApplicationService):
    def __init__(self) -> None:
        pass

    async def create_application_from_capture(self, *, user_id: str, job_url: str, capture):
        return ApplicationRecord(
            id="app-1",
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
            visible_status="draft",
            internal_state="extraction_pending",
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

    async def get_application_detail(self, *, user_id: str, application_id: str) -> ApplicationDetailPayload:
        return ApplicationDetailPayload(
            application=ApplicationRecord(
                id=application_id,
                user_id=user_id,
                job_url="https://example.com/jobs/1",
                job_title=None,
                company=None,
                job_description=None,
                extracted_reference_id=None,
                job_posting_origin=None,
                job_posting_origin_other_text=None,
                base_resume_id=None,
                base_resume_name=None,
                visible_status="draft",
                internal_state="extraction_pending",
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
            ),
            duplicate_warning=None,
        )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_extension_status_requires_authentication():
    client = TestClient(app)
    response = client.get("/api/extension/status")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


def test_extension_token_issue_and_revoke_flow():
    repository = StubProfileRepository()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: repository
    client = TestClient(app)

    issue_response = client.post("/api/extension/token", headers={"Authorization": "Bearer valid-token"})
    assert issue_response.status_code == 200
    assert issue_response.json()["token"].startswith("jabr_ext_")
    assert issue_response.json()["status"]["connected"] is True

    status_response = client.get("/api/extension/status", headers={"Authorization": "Bearer valid-token"})
    assert status_response.status_code == 200
    assert status_response.json()["connected"] is True

    revoke_response = client.delete("/api/extension/token", headers={"Authorization": "Bearer valid-token"})
    assert revoke_response.status_code == 200
    assert revoke_response.json()["connected"] is False


def test_extension_import_rejects_missing_or_invalid_extension_tokens():
    repository = StubProfileRepository()
    app.dependency_overrides[get_profile_repository] = lambda: repository
    app.dependency_overrides[get_application_service] = lambda: StubApplicationService()
    client = TestClient(app)

    payload = {
        "job_url": "https://example.com/jobs/1",
        "source_url": "https://example.com/jobs/1",
        "page_title": "Backend Engineer",
        "source_text": "Backend Engineer role at Acme.",
        "meta": {},
        "json_ld": [],
        "captured_at": "2026-04-07T12:00:00+00:00",
    }

    missing_response = client.post("/api/extension/import", json=payload)
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Missing extension token."

    invalid_response = client.post(
        "/api/extension/import",
        json=payload,
        headers={"X-Extension-Token": "invalid-token"},
    )
    assert invalid_response.status_code == 401
    assert invalid_response.json()["detail"] == "Invalid extension token."
