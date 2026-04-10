from __future__ import annotations

from typing import Optional

import pytest

from app.core.config import Settings
from app.db.admin import InviteRecord
from app.db.profiles import ProfileRecord
from app.services.admin import AdminService
from app.services.email import EmailMessage


class StubAdminRepository:
    def __init__(self) -> None:
        self.revoked_invitee_user_id: Optional[str] = None
        self.created_invite: Optional[InviteRecord] = None
        self.usage_events: list[tuple[str, str, str]] = []

    def revoke_pending_invites(self, *, invitee_user_id: str) -> None:
        self.revoked_invitee_user_id = invitee_user_id

    def create_invite(
        self,
        *,
        invitee_user_id: str,
        invited_by_user_id: str,
        invited_email: str,
        token_hash: str,
        expires_at: str,
    ) -> InviteRecord:
        self.created_invite = InviteRecord(
            id="invite-1",
            invitee_user_id=invitee_user_id,
            invited_by_user_id=invited_by_user_id,
            invited_email=invited_email,
            status="pending",
            expires_at=expires_at,
            sent_at="2026-04-10T00:00:00+00:00",
            accepted_at=None,
            created_at="2026-04-10T00:00:00+00:00",
            updated_at="2026-04-10T00:00:00+00:00",
        )
        return self.created_invite

    def create_usage_event(self, *, user_id: str, event_type: str, event_status: str) -> None:
        self.usage_events.append((user_id, event_type, event_status))


class StubProfileRepository:
    def __init__(self, existing_profile: Optional[ProfileRecord] = None) -> None:
        self._existing_profile = existing_profile
        self.update_calls = 0

    def fetch_profile_by_email(self, email: str) -> Optional[ProfileRecord]:
        return self._existing_profile

    def update_profile(self, user_id: str, updates: dict[str, object]) -> Optional[ProfileRecord]:
        self.update_calls += 1
        return None


class StubSupabaseAdminClient:
    def __init__(self, *, user_id: str = "user-123") -> None:
        self.user_id = user_id
        self.create_user_calls = 0

    async def create_user(self, *, email: str, password: str, email_confirm: bool = True) -> str:
        self.create_user_calls += 1
        return self.user_id


class FailingEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        raise RuntimeError("resend failed")


class SuccessfulEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        return "email_1"


@pytest.mark.asyncio
async def test_invite_user_fails_closed_when_email_notifications_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "false")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    repository = StubAdminRepository()
    profiles = StubProfileRepository()
    supabase_admin = StubSupabaseAdminClient()
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=profiles,  # type: ignore[arg-type]
        supabase_admin=supabase_admin,  # type: ignore[arg-type]
        email_sender=SuccessfulEmailSender(),  # type: ignore[arg-type]
        settings=Settings(),
    )

    with pytest.raises(ValueError, match="Invite delivery is disabled"):
        await service.invite_user(
            invited_by_user_id="admin-1",
            email="invitee@example.com",
            first_name="Invitee",
            last_name="User",
        )

    assert repository.created_invite is None
    assert repository.usage_events == []
    assert supabase_admin.create_user_calls == 0
    assert profiles.update_calls == 0


@pytest.mark.asyncio
async def test_invite_user_records_failure_when_email_delivery_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")

    repository = StubAdminRepository()
    profiles = StubProfileRepository()
    supabase_admin = StubSupabaseAdminClient(user_id="invitee-1")
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=profiles,  # type: ignore[arg-type]
        supabase_admin=supabase_admin,  # type: ignore[arg-type]
        email_sender=FailingEmailSender(),  # type: ignore[arg-type]
        settings=Settings(),
    )

    with pytest.raises(ValueError, match="Invite email delivery failed"):
        await service.invite_user(
            invited_by_user_id="admin-1",
            email="invitee@example.com",
            first_name=None,
            last_name=None,
        )

    assert repository.created_invite is not None
    assert repository.usage_events == [("invitee-1", "invite_sent", "failure")]

