from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


LOCAL_DEV_JWT_PUBLIC_KEY_SHA256 = "0344dabdc1bc2f4a2ab708f405d47ac75244e6d993c2288ac7fa4891e91fb6d6"


def _pem_fingerprint(value: str) -> str:
    normalized = value.replace("\\n", "\n").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class EmailSettings(BaseModel):
    notifications_enabled: bool = False
    resend_api_key: Optional[str] = None
    email_from: Optional[str] = None

    @model_validator(mode="after")
    def validate_required_fields(self) -> "EmailSettings":
        if not self.notifications_enabled:
            return self

        missing = []
        if not self.resend_api_key:
            missing.append("RESEND_API_KEY")
        if not self.email_from:
            missing.append("EMAIL_FROM")

        if missing:
            missing_names = ", ".join(missing)
            raise ValueError(
                f"Email notifications require {missing_names} when EMAIL_NOTIFICATIONS_ENABLED=true."
            )

        return self


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    app_dev_mode: bool = Field(default=False, alias="APP_DEV_MODE")
    api_port: int = Field(default=8000, alias="API_PORT")
    app_url: str = Field(default="http://localhost:5173", alias="APP_URL")
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/postgres",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    cors_origins: str = Field(
        default="http://localhost:5173,https://applix.ca,https://www.applix.ca",
        alias="CORS_ORIGINS",
    )
    chrome_extension_origins: str = Field(default="", alias="CHROME_EXTENSION_ORIGINS")
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_fail_closed: bool = Field(default=True, alias="RATE_LIMIT_FAIL_CLOSED")
    trusted_proxy_hops: int = Field(default=0, ge=0, le=5, alias="TRUSTED_PROXY_HOPS")
    jwt_private_key: str = Field(..., alias="JWT_PRIVATE_KEY")
    jwt_public_key: str = Field(..., alias="JWT_PUBLIC_KEY")
    access_token_expire_minutes: int = Field(default=15, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    worker_callback_secret: Optional[str] = Field(default=None, alias="WORKER_CALLBACK_SECRET")
    duplicate_similarity_threshold: float = Field(
        default=85.0, alias="DUPLICATE_SIMILARITY_THRESHOLD"
    )
    email_notifications_enabled: bool = Field(
        default=False, alias="EMAIL_NOTIFICATIONS_ENABLED"
    )
    resend_api_key: Optional[str] = Field(default=None, alias="RESEND_API_KEY")
    email_from: Optional[str] = Field(default=None, alias="EMAIL_FROM")
    shared_contract_path: str = Field(
        default="/app/app/core/workflow-contract.json", alias="SHARED_CONTRACT_PATH"
    )
    openrouter_api_key: Optional[str] = Field(default=None, alias="OPENROUTER_API_KEY")
    openrouter_cleanup_model: str = Field(
        default="openai/gpt-4o-mini", alias="OPENROUTER_CLEANUP_MODEL"
    )
    admin_emails: str = Field(default="", alias="ADMIN_EMAILS")
    invite_link_expiry_hours: int = Field(default=168, alias="INVITE_LINK_EXPIRY_HOURS")

    @property
    def email(self) -> EmailSettings:
        return EmailSettings(
            notifications_enabled=self.email_notifications_enabled,
            resend_api_key=self.resend_api_key,
            email_from=self.email_from,
        )

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        self.email
        if self.app_dev_mode:
            database_host = (urlparse(self.database_url).hostname or "").lower()
            app_host = (urlparse(self.app_url).hostname or "").lower()
            local_hosts = {"localhost", "127.0.0.1", "postgres"}
            if self.app_env != "development" or database_host not in local_hosts or app_host not in local_hosts:
                raise ValueError(
                    "APP_DEV_MODE may only be enabled for the local development stack."
                )
        if self.app_env == "production" and not self.rate_limit_enabled:
            raise ValueError("RATE_LIMIT_ENABLED cannot be disabled in production.")
        if self.app_env == "production" and not self.rate_limit_fail_closed:
            raise ValueError("RATE_LIMIT_FAIL_CLOSED cannot be disabled in production.")
        if (
            self.app_env == "production"
            and _pem_fingerprint(self.jwt_public_key) == LOCAL_DEV_JWT_PUBLIC_KEY_SHA256
        ):
            raise ValueError("The repository's local-development JWT key cannot be used in production.")
        if "*" in self.cors_origin_list:
            raise ValueError("Wildcard CORS origins are not allowed with credentials.")
        extension_origin_pattern = re.compile(r"^chrome-extension://[a-p]{32}$")
        if any(
            extension_origin_pattern.fullmatch(origin) is None
            for origin in self.chrome_extension_origin_list
        ):
            raise ValueError(
                "CHROME_EXTENSION_ORIGINS must contain exact Chrome extension origins."
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def chrome_extension_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.chrome_extension_origins.split(",")
            if origin.strip()
        ]

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def is_local_dev_mode(self) -> bool:
        return self.app_dev_mode

    @property
    def admin_email_list(self) -> list[str]:
        return [
            email.strip().lower()
            for email in self.admin_emails.split(",")
            if email.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
