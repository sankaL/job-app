from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_email_settings_allow_disabled_mode_without_resend_credentials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "false")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    settings = Settings()

    assert settings.email.notifications_enabled is False
    assert settings.email.resend_api_key is None
    assert settings.email.email_from is None


def test_email_settings_reject_enabled_mode_without_required_credentials(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    with pytest.raises(ValidationError) as exc_info:
        Settings()

    assert "RESEND_API_KEY" in str(exc_info.value)
    assert "EMAIL_FROM" in str(exc_info.value)


def test_email_settings_accept_enabled_mode_with_resend_credentials(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")

    settings = Settings()

    assert settings.email.notifications_enabled is True
    assert settings.email.resend_api_key == "re_test_123"
    assert settings.email.email_from == "noreply@example.com"
