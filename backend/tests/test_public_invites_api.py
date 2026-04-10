from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from typing import Optional

from app.main import app
from app.services.admin import AdminService, InviteAcceptResult, InvitePreviewPayload, get_admin_service


class StubPublicInviteService(AdminService):
    def __init__(self) -> None:
        pass

    def preview_invite(self, *, token: str) -> InvitePreviewPayload:
        if token == "expired":
            raise PermissionError("Invite link has expired.")
        if token != "valid-token":
            raise LookupError("Invite not found.")
        return InvitePreviewPayload(
            invited_email="invitee@example.com",
            expires_at="2026-04-17T00:00:00+00:00",
        )

    async def accept_invite(
        self,
        *,
        token: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        phone: str,
        address: str,
        linkedin_url: Optional[str],
    ) -> InviteAcceptResult:
        if token != "valid-token":
            raise LookupError("Invite not found.")
        return InviteAcceptResult(user_id="user-1", email=email)


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_invite_preview_returns_email_and_expiry():
    app.dependency_overrides[get_admin_service] = lambda: StubPublicInviteService()
    client = TestClient(app)

    response = client.get("/api/public/invites/preview?token=valid-token")

    assert response.status_code == 200
    payload = response.json()
    assert payload["invited_email"] == "invitee@example.com"


def test_invite_preview_surfaces_expired_error():
    app.dependency_overrides[get_admin_service] = lambda: StubPublicInviteService()
    client = TestClient(app)

    response = client.get("/api/public/invites/preview?token=expired")
    assert response.status_code == 403
    assert response.json()["detail"] == "Invite link has expired."


def test_accept_invite_requires_password_confirmation_match():
    app.dependency_overrides[get_admin_service] = lambda: StubPublicInviteService()
    client = TestClient(app)

    response = client.post(
        "/api/public/invites/accept",
        json={
            "token": "valid-token",
            "email": "invitee@example.com",
            "password": "StrongPass!123",
            "confirm_password": "StrongPass!456",
            "first_name": "Invited",
            "last_name": "User",
            "phone": "555-0100",
            "address": "Toronto, ON",
            "linkedin_url": "https://linkedin.com/in/invitee",
        },
    )

    assert response.status_code == 422


def test_accept_invite_rejects_weak_password():
    app.dependency_overrides[get_admin_service] = lambda: StubPublicInviteService()
    client = TestClient(app)

    response = client.post(
        "/api/public/invites/accept",
        json={
            "token": "valid-token",
            "email": "invitee@example.com",
            "password": "weakpass",
            "confirm_password": "weakpass",
            "first_name": "Invited",
            "last_name": "User",
            "phone": "555-0100",
            "address": "Toronto, ON",
        },
    )

    assert response.status_code == 422


def test_accept_invite_returns_user_identity():
    app.dependency_overrides[get_admin_service] = lambda: StubPublicInviteService()
    client = TestClient(app)

    response = client.post(
        "/api/public/invites/accept",
        json={
            "token": "valid-token",
            "email": "invitee@example.com",
            "password": "StrongPass!123",
            "confirm_password": "StrongPass!123",
            "first_name": "Invited",
            "last_name": "User",
            "phone": "555-0100",
            "address": "Toronto, ON",
            "linkedin_url": "https://linkedin.com/in/invitee",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "user-1"
    assert payload["email"] == "invitee@example.com"
