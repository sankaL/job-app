from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from app.core.config import Settings
import app.core.config as config_module


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


def test_production_rejects_dev_mode_and_disabled_rate_limits(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_DEV_MODE", "true")
    monkeypatch.setenv("APP_URL", "https://applix.ca")
    monkeypatch.setenv("DATABASE_URL", "postgresql://app@db.internal/app")

    with pytest.raises(ValidationError, match="APP_DEV_MODE"):
        Settings()

    monkeypatch.setenv("APP_DEV_MODE", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    with pytest.raises(ValidationError, match="RATE_LIMIT_ENABLED"):
        Settings()


def test_cors_rejects_wildcards_and_invalid_extension_origins(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValidationError, match="Wildcard CORS"):
        Settings()

    monkeypatch.setenv("CORS_ORIGINS", "https://applix.ca")
    monkeypatch.setenv("CHROME_EXTENSION_ORIGINS", "chrome-extension://not-an-extension-id")
    with pytest.raises(ValidationError, match="exact Chrome extension origins"):
        Settings()


def test_production_rejects_repository_local_jwt_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_DEV_MODE", "false")
    monkeypatch.setenv("APP_URL", "https://applix.ca")
    monkeypatch.setenv("DATABASE_URL", "postgresql://app@db.internal/app")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("RATE_LIMIT_FAIL_CLOSED", "true")
    monkeypatch.setattr(
        config_module,
        "LOCAL_DEV_JWT_PUBLIC_KEY_SHA256",
        config_module._pem_fingerprint(os.environ["JWT_PUBLIC_KEY"]),
    )

    with pytest.raises(ValidationError, match="local-development JWT key"):
        Settings()
