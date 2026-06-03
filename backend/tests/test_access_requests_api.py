from __future__ import annotations

import copy
from types import SimpleNamespace
from typing import Literal, Optional

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.access_request_guard import AccessRequestGuard, get_access_request_guard
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
        interested_plan: Literal["standard", "pro", "not_sure"],
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


class NoneEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        return None


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    get_access_request_guard.cache_clear()
    yield
    app.dependency_overrides = original
    get_access_request_guard.cache_clear()


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


@pytest.mark.parametrize(
    ("email"),
    ["invalid", "a@b", "test@test"],
)
def test_access_request_endpoint_rejects_invalid_email(email: str):
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": email,
            "interested_plan": "standard",
        },
    )

    assert response.status_code == 422
    assert service.requests == []


def test_access_request_endpoint_rejects_invalid_plan():
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "enterprise",
        },
    )

    assert response.status_code == 422
    assert service.requests == []


def test_access_request_endpoint_rejects_note_over_max_length():
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "standard",
            "note": "x" * 1001,
        },
    )

    assert response.status_code == 422
    assert service.requests == []


def test_access_request_endpoint_normalizes_blank_note_to_none():
    service = StubAccessRequestService()
    app.dependency_overrides[get_access_request_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/api/public/access-requests",
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "standard",
            "note": "   ",
        },
    )

    assert response.status_code == 202
    assert service.requests[0]["note"] is None


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
    assert response.json()["detail"] == "Access request processing is currently unavailable."


def test_access_request_endpoint_rate_limits_by_client_ip():
    service = StubAccessRequestService()
    clock = {"value": 0.0}
    guard = AccessRequestGuard(
        max_requests_per_window=2,
        rate_limit_window_seconds=60,
        duplicate_window_seconds=300,
        clock=lambda: clock["value"],
    )
    app.dependency_overrides[get_access_request_service] = lambda: service
    app.dependency_overrides[get_access_request_guard] = lambda: guard
    client = TestClient(app)

    for index in range(2):
        response = client.post(
            "/api/public/access-requests",
            headers={"x-forwarded-for": "203.0.113.10"},
            json={
                "full_name": f"Jane Doe {index}",
                "email": f"jane{index}@example.com",
                "interested_plan": "standard",
            },
        )
        assert response.status_code == 202

    response = client.post(
        "/api/public/access-requests",
        headers={"x-forwarded-for": "203.0.113.10"},
        json={
            "full_name": "Jane Doe 3",
            "email": "jane3@example.com",
            "interested_plan": "standard",
        },
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    assert response.json()["detail"] == "Too many access requests from this client. Please try again later."
    assert len(service.requests) == 2


def test_access_request_endpoint_suppresses_duplicate_successful_submissions():
    service = StubAccessRequestService()
    clock = {"value": 0.0}
    guard = AccessRequestGuard(
        max_requests_per_window=5,
        rate_limit_window_seconds=60,
        duplicate_window_seconds=300,
        clock=lambda: clock["value"],
    )
    app.dependency_overrides[get_access_request_service] = lambda: service
    app.dependency_overrides[get_access_request_guard] = lambda: guard
    client = TestClient(app)

    first = client.post(
        "/api/public/access-requests",
        headers={"x-forwarded-for": "203.0.113.10"},
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "standard",
        },
    )
    second = client.post(
        "/api/public/access-requests",
        headers={"x-forwarded-for": "203.0.113.10"},
        json={
            "full_name": "Jane Doe",
            "email": "jane@example.com",
            "interested_plan": "standard",
        },
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert len(service.requests) == 1


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


@pytest.mark.asyncio
async def test_access_request_service_fails_closed_without_admin_recipients():
    sender = FakeEmailSender()
    settings = SimpleNamespace(
        admin_email_list=[],
        email=SimpleNamespace(notifications_enabled=True),
    )
    service = AccessRequestService(settings=settings, email_sender=sender)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="recipient is not configured"):
        await service.submit_request(
            full_name="Jane Doe",
            email="jane@example.com",
            interested_plan="standard",
            note=None,
        )


@pytest.mark.asyncio
async def test_access_request_service_fails_closed_without_delivery_receipt():
    settings = SimpleNamespace(
        admin_email_list=["admin@example.com"],
        email=SimpleNamespace(notifications_enabled=True),
    )
    service = AccessRequestService(settings=settings, email_sender=NoneEmailSender())  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="provider receipt"):
        await service.submit_request(
            full_name="Jane Doe",
            email="jane@example.com",
            interested_plan="standard",
            note=None,
        )
