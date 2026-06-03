from __future__ import annotations

import copy
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.access_requests import AccessRequestService, get_access_request_service
from app.services.email import EmailMessage


class StubAccessRequestService:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.requests: list[dict[str, Optional[str]]] = []

    async def submit_request(
        self,
        *,
        full_name: str,
        email: str,
        interested_plan: str,
        note: Optional[str],
    ) -> None:
        if self.fail:
            raise ValueError("Access request delivery is not configured.")
        self.requests.append(
            {
                "full_name": full_name,
                "email": email,
                "interested_plan": interested_plan,
                "note": note,
            }
        )


class FakeEmailSender:
    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []

    async def send(self, message: EmailMessage) -> Optional[str]:
        self.messages.append(message)
        return "email-1"


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_access_request_endpoint_submits_payload():
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "  Jane Doe  ",
            "email": "JANE@EXAMPLE.COM",
            "interested_plan": "pro",
            "note": "Applying for design roles.",
        },
    )

    assert response.status_code == 202
    assert response.json()["status"] == "submitted"
    assert service.requests == [
        {
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "pro",
            "note": "Applying for design roles.",
        }
    ]


def test_access_request_endpoint_rejects_invalid_email():
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": "invalid",
            "interested_plan": "standard",
        },
    )

    assert response.status_code == 422
    assert service.requests == []


def test_access_request_endpoint_fails_closed_when_delivery_unavailable():
    app.dependency_overrides[get_access_request_service] = lambda: StubAccessRequestService(fail=True)
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "standard",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Access request delivery is not configured."


@pytest.mark.asyncio
async def test_access_request_service_sends_sanitized_admin_email():
    sender = FakeEmailSender()
    settings = SimpleNamespace(
        admin_email_list=["admin@example.com"],
        email=SimpleNamespace(notifications_enabled=True),
    )
    service = AccessRequestService(settings=settings, email_sender=sender)  # type: ignore[arg-type]

    await service.submit_request(
        full_name="Jane <Doe>",
        email="Jane@Example.com",
        interested_plan="pro",
        note="<script>alert('x')</script>",
    )

    assert len(sender.messages) == 1
    message = sender.messages[0]
    assert message.to == ["admin@example.com"]
    assert "Jane <Doe>" in message.text
    assert "<script>" in message.text
    assert "Jane &lt;Doe&gt;" in (message.html or "")
    assert "&lt;script&gt;" in (message.html or "")
