from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import Settings
from app.services.email import EmailMessage, NoOpEmailSender, ResendEmailSender, build_email_sender


@pytest.mark.asyncio
async def test_email_sender_noops_when_notifications_are_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "false")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    sender = build_email_sender(Settings())

    assert isinstance(sender, NoOpEmailSender)
    assert await sender.send(EmailMessage(to=["user@example.com"], subject="Test", text="hello")) is None


@pytest.mark.asyncio
async def test_email_sender_posts_expected_payload_to_resend(monkeypatch: pytest.MonkeyPatch):
    requests: list[httpx.Request] = []

    async def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "email_123"})

    transport = httpx.MockTransport(handle)
    async with httpx.AsyncClient(transport=transport) as client:
        monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
        monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
        monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")

        sender = build_email_sender(Settings(), client=client)

        assert isinstance(sender, ResendEmailSender)
        message_id = await sender.send(
            EmailMessage(
                to=["user@example.com"],
                subject="Resume ready",
                text="Your resume is ready.",
            )
        )

    assert message_id == "email_123"
    assert len(requests) == 1
    assert requests[0].url == httpx.URL("https://api.resend.com/emails")
    assert requests[0].headers["Authorization"] == "Bearer re_test_123"
    assert json.loads(requests[0].content) == {
        "from": "noreply@example.com",
        "to": ["user@example.com"],
        "subject": "Resume ready",
        "text": "Your resume is ready.",
    }


@pytest.mark.asyncio
async def test_email_sender_retries_retryable_resend_failures(monkeypatch: pytest.MonkeyPatch):
    requests: list[httpx.Request] = []
    attempts = {"count": 0}

    async def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        attempts["count"] += 1
        if attempts["count"] == 1:
            return httpx.Response(503, json={"message": "temporary failure"}, request=request)
        return httpx.Response(200, json={"id": "email_retry_success"}, request=request)

    async def skip_sleep(_: float) -> None:
        return None

    transport = httpx.MockTransport(handle)
    async with httpx.AsyncClient(transport=transport) as client:
        monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
        monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
        monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
        monkeypatch.setattr("app.services.email.asyncio.sleep", skip_sleep)

        sender = build_email_sender(Settings(), client=client)
        message_id = await sender.send(
            EmailMessage(
                to=["user@example.com"],
                subject="Retry me",
                text="First call can fail.",
            )
        )

    assert message_id == "email_retry_success"
    assert len(requests) == 2


def test_branded_email_escapes_values_and_renders_cta():
    from app.services.email_templates import render_branded_email

    email = render_branded_email(
        eyebrow="Test",
        heading="Hello <b>",
        body="Line one\n\nLine two",
        cta_label="Open",
        cta_url="https://app.example.com/x?a=1&b=2",
        details=[("Name", "<script>alert(1)</script>")],
        footnote="Expires soon.",
    )

    assert "<script>" not in email.html
    assert "&lt;script&gt;" in email.html
    assert "Hello &lt;b&gt;" in email.html
    assert 'href="https://app.example.com/x?a=1&amp;b=2"' in email.html
    assert "Open: https://app.example.com/x?a=1&b=2" in email.text
    assert "Name: <script>alert(1)</script>" in email.text
