from __future__ import annotations

import copy
from typing import Optional

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.session import SessionBootstrapResponse
from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.core.workflow_contract import get_workflow_contract
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository
from app.main import app


class StubProfileRepository(ProfileRepository):
    def __init__(self) -> None:
        pass

    def fetch_profile(self, user_id: str) -> Optional[ProfileRecord]:
        return ProfileRecord(
            id=user_id,
            email="invite-only@example.com",
            name=None,
            phone=None,
            address=None,
            default_base_resume_id=None,
            section_preferences={
                "summary": True,
                "professional_experience": True,
                "education": True,
                "skills": True,
            },
            section_order=["summary", "professional_experience", "education", "skills"],
            created_at="2026-04-07T00:00:00+00:00",
            updated_at="2026-04-07T00:00:00+00:00",
        )


class MissingProfileRepository(ProfileRepository):
    def __init__(self) -> None:
        pass

    def fetch_profile(self, user_id: str) -> Optional[ProfileRecord]:
        return None


class StubVerifier(AuthVerifier):
    def __init__(self) -> None:
        pass

    def verify_token(self, token: str) -> AuthenticatedUser:
        if token != "valid-token":
            raise HTTPException(status_code=401, detail="Invalid Supabase access token.")

        return AuthenticatedUser(
            id="user-123",
            email="invite-only@example.com",
            role="authenticated",
            claims={"sub": "user-123", "email": "invite-only@example.com", "role": "authenticated"},
        )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_missing_token_returns_401():
    client = TestClient(app)
    response = client.get("/api/session/bootstrap")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


def test_invalid_token_returns_401():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    client = TestClient(app)

    response = client.get(
        "/api/session/bootstrap",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Supabase access token."


def test_valid_token_bootstraps_authenticated_user_only():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: StubProfileRepository()
    client = TestClient(app)

    response = client.get(
        "/api/session/bootstrap",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    payload = SessionBootstrapResponse.model_validate(response.json())
    assert payload.user.id == "user-123"
    assert payload.user.email == "invite-only@example.com"
    assert payload.profile is not None
    assert payload.profile.id == "user-123"
    assert payload.workflow_contract_version == get_workflow_contract().version


def test_valid_token_without_profile_fails_closed():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: MissingProfileRepository()
    client = TestClient(app)

    response = client.get(
        "/api/session/bootstrap",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Authenticated profile is unavailable."
