from __future__ import annotations

import copy
import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository
from app.main import app


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


class StubProfileRepository(ProfileRepository):
    def __init__(self) -> None:
        self.record = ProfileRecord(
            id="user-123",
            email="invite-only@example.com",
            name="Alex Example",
            phone="555-0100",
            address="Toronto, ON",
            linkedin_url="https://linkedin.com/in/alex-example",
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

    def fetch_profile(self, user_id: str):
        if user_id != self.record.id:
            return None
        return self.record

    def update_profile(self, user_id: str, updates: dict):
        if user_id != self.record.id:
            return None
        self.record = self.record.model_copy(update={**updates, "updated_at": "2026-04-09T20:18:29+00:00"})
        return self.record


class FailingProfileRepository(ProfileRepository):
    def __init__(self) -> None:
        pass

    def fetch_profile(self, user_id: str):
        return ProfileRecord(
            id=user_id,
            email="invite-only@example.com",
            name="Alex Example",
            phone=None,
            address=None,
            linkedin_url=None,
            is_active=True,
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

    def update_profile(self, user_id: str, updates: dict):
        raise RuntimeError("sensitive-db-error-text")


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_get_profile_returns_linkedin_url():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: StubProfileRepository()
    client = TestClient(app)

    response = client.get(
        "/api/profiles",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["linkedin_url"] == "https://linkedin.com/in/alex-example"
    assert payload["address"] == "Toronto, ON"


def test_patch_profile_persists_linkedin_url():
    repository = StubProfileRepository()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: repository
    client = TestClient(app)

    response = client.patch(
        "/api/profiles",
        headers={"Authorization": "Bearer valid-token"},
        json={
            "address": " Ottawa, ON ",
            "linkedin_url": " https://linkedin.com/in/alex-updated ",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["address"] == "Ottawa, ON"
    assert payload["linkedin_url"] == "https://linkedin.com/in/alex-updated"


def test_patch_profile_logs_sanitized_error_details(caplog: pytest.LogCaptureFixture):
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_profile_repository] = lambda: FailingProfileRepository()
    client = TestClient(app)

    with caplog.at_level(logging.ERROR, logger="app.api.profiles"):
        response = client.patch(
            "/api/profiles",
            headers={"Authorization": "Bearer valid-token"},
            json={
                "address": "123 Secret Street",
                "section_preferences": {"summary": True},
            },
        )

    assert response.status_code == 500
    assert response.json() == {"detail": "Profile request failed."}

    messages = [record.getMessage() for record in caplog.records if record.name == "app.api.profiles"]
    assert len(messages) == 1
    log_line = messages[0]
    assert "error_type=RuntimeError" in log_line
    assert "update_fields=['address', 'section_preferences']" in log_line
    assert "123 Secret Street" not in log_line
    assert "sensitive-db-error-text" not in log_line


def test_profile_repository_wraps_jsonb_update_values():
    repository = ProfileRepository("postgresql://example")

    wrapped_preferences = repository._prepare_value("section_preferences", {"summary": True})
    wrapped_order = repository._prepare_value("section_order", ["summary", "skills"])

    assert isinstance(wrapped_preferences, Jsonb)
    assert isinstance(wrapped_order, Jsonb)
    assert repository._prepare_value("name", "Alex Example") == "Alex Example"
    assert repository._cast_placeholder("section_preferences").as_string(None) == "%s::jsonb"
    assert repository._cast_placeholder("section_order").as_string(None) == "%s::jsonb"
