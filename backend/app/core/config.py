from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
        default="postgresql://postgres:postgres@localhost:54322/postgres",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    supabase_url: str = Field(default="http://localhost:54321", alias="SUPABASE_URL")
    supabase_external_url: str = Field(
        default="http://localhost:54321", alias="SUPABASE_EXTERNAL_URL"
    )
    supabase_auth_jwks_url: str = Field(
        default="http://localhost:54321/auth/v1/.well-known/jwks.json",
        alias="SUPABASE_AUTH_JWKS_URL",
    )
    supabase_jwt_secret: Optional[str] = Field(default=None, alias="SUPABASE_JWT_SECRET")
    supabase_jwt_audience: str = Field(default="authenticated", alias="SUPABASE_JWT_AUDIENCE")
    supabase_jwt_issuer: Optional[str] = Field(default=None, alias="SUPABASE_JWT_ISSUER")
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
        default="/workspace/shared/workflow-contract.json", alias="SHARED_CONTRACT_PATH"
    )

    @property
    def email(self) -> EmailSettings:
        return EmailSettings(
            notifications_enabled=self.email_notifications_enabled,
            resend_api_key=self.resend_api_key,
            email_from=self.email_from,
        )

    @model_validator(mode="after")
    def validate_email_settings(self) -> "Settings":
        self.email
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
