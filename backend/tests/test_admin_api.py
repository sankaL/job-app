from __future__ import annotations

import copy
from typing import Optional

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository
from app.main import app
from app.services.admin import AdminMetricsPayload, AdminOperationMetric, AdminService, get_admin_service


class StubVerifier(AuthVerifier):
    def __init__(self) -> None:
        pass

    def verify_token(self, token: str) -> AuthenticatedUser:
        if token != "valid-admin-token":
            raise HTTPException(status_code=401, detail="Invalid Supabase access token.")
        return AuthenticatedUser(
            id="admin-1",
            email="admin@example.com",
            role="authenticated",
            claims={"sub": "admin-1", "email": "admin@example.com"},
        )


class StubProfileRepository(ProfileRepository):
    def __init__(self, *, is_admin: bool = True) -> None:
        self.is_admin = is_admin

    def fetch_profile(self, user_id: str) -> Optional[ProfileRecord]:
        return ProfileRecord(
            id=user_id,
            email="admin@example.com",
            first_name="Admin",
            last_name="User",
            name="Admin User",
            phone=None,
            address=None,
            linkedin_url=None,
            is_admin=self.is_admin,
            is_active=True,
            onboarding_completed_at="2026-04-10T00:00:00+00:00",
            default_base_resume_id=None,
            section_preferences={
                "summary": True,
                "professional_experience": True,
                "education": True,
                "skills": True,
            },
            section_order=["summary", "professional_experience", "education", "skills"],
            created_at="2026-04-10T00:00:00+00:00",
            updated_at="2026-04-10T00:00:00+00:00",
        )

    def update_profile(self, user_id: str, updates: dict):  # pragma: no cover - bootstrap branch only
        return self.fetch_profile(user_id)


class StubAdminService(AdminService):
    def __init__(self) -> None:
        pass

    def get_metrics(self) -> AdminMetricsPayload:
        metric = AdminOperationMetric(total=10, success_count=9, failure_count=1, success_rate=90.0)
        return AdminMetricsPayload(
            total_users=5,
            active_users=4,
            deactivated_users=1,
            invited_users=2,
            total_applications=17,
            invites_sent=8,
            invites_accepted=6,
            invites_pending=2,
            extraction=metric,
            generation=metric,
            regeneration=metric,
            export=metric,
        )

    def list_users(self, *, search: Optional[str], status: Optional[str]):
        return []

    async def invite_user(self, *, invited_by_user_id: str, email: str, first_name: Optional[str], last_name: Optional[str]):
        from app.services.admin import InviteResultPayload

        return InviteResultPayload(
            invite_id="invite-1",
            invitee_user_id="user-1",
            invited_email=email,
            expires_at="2026-04-17T00:00:00+00:00",
        )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_admin_metrics_requires_admin_permissions():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: StubProfileRepository(is_admin=False)
    app.dependency_overrides[get_admin_service] = lambda: StubAdminService()
    client = TestClient(app)

    response = client.get("/api/admin/metrics", headers={"Authorization": "Bearer valid-admin-token"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Admin access is required."


def test_admin_metrics_returns_payload():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: StubProfileRepository(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: StubAdminService()
    client = TestClient(app)

    response = client.get("/api/admin/metrics", headers={"Authorization": "Bearer valid-admin-token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_users"] == 5
    assert payload["generation"]["success_rate"] == 90.0


def test_admin_invite_returns_created_payload():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: StubProfileRepository(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: StubAdminService()
    client = TestClient(app)

    response = client.post(
        "/api/admin/users/invite",
        headers={"Authorization": "Bearer valid-admin-token"},
        json={"email": "new-user@example.com", "first_name": "New", "last_name": "User"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["invite_id"] == "invite-1"
    assert payload["invited_email"] == "new-user@example.com"
