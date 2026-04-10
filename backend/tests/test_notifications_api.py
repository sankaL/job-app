from __future__ import annotations

import copy

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.db.notifications import NotificationRecord, NotificationRepository, get_notification_repository
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


class StubNotificationRepository(NotificationRepository):
    def __init__(self) -> None:
        self.records = [
            {
                "id": "notif-1",
                "user_id": "user-999",
                "application_id": "app-hidden",
                "type": "error",
                "message": "Should not leak across users.",
                "action_required": True,
                "read": False,
                "created_at": "2026-04-09T14:00:00+00:00",
            },
            {
                "id": "notif-2",
                "user_id": "user-123",
                "application_id": None,
                "type": "success",
                "message": "Export completed successfully.",
                "action_required": False,
                "read": True,
                "created_at": "2026-04-09T15:00:00+00:00",
            },
            {
                "id": "notif-3",
                "user_id": "user-123",
                "application_id": "app-123",
                "type": "warning",
                "message": "Resume needs manual review.",
                "action_required": True,
                "read": False,
                "created_at": "2026-04-09T13:00:00+00:00",
            },
        ]

    def list_notifications(self, user_id: str) -> list[NotificationRecord]:
        scoped = [record for record in self.records if record["user_id"] == user_id]
        ordered = sorted(scoped, key=lambda record: (record["created_at"], record["id"]), reverse=True)
        return [NotificationRecord.model_validate(record) for record in ordered]

    def clear_notifications(self, user_id: str) -> None:
        self.records = [
            record
            for record in self.records
            if record["user_id"] != user_id or record["action_required"] is True
        ]


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_missing_token_returns_401():
    client = TestClient(app)

    response = client.get("/api/notifications")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


def test_list_notifications_returns_scoped_results_in_descending_created_order():
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_notification_repository] = lambda: StubNotificationRepository()
    client = TestClient(app)

    response = client.get(
        "/api/notifications",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "notif-2",
            "application_id": None,
            "type": "success",
            "message": "Export completed successfully.",
            "action_required": False,
            "read": True,
            "created_at": "2026-04-09T15:00:00+00:00",
        },
        {
            "id": "notif-3",
            "application_id": "app-123",
            "type": "warning",
            "message": "Resume needs manual review.",
            "action_required": True,
            "read": False,
            "created_at": "2026-04-09T13:00:00+00:00",
        },
    ]


def test_clear_notifications_preserves_action_required_items_for_the_authenticated_user():
    repository = StubNotificationRepository()
    app.dependency_overrides[get_auth_verifier] = lambda: StubVerifier()
    app.dependency_overrides[get_notification_repository] = lambda: repository
    client = TestClient(app)

    response = client.delete(
        "/api/notifications",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 204
    assert response.content == b""
    assert [record["id"] for record in repository.records] == ["notif-1", "notif-3"]
