from __future__ import annotations

from typing import Optional

import pytest

from app.core.config import Settings
from app.db.admin import InviteRecord
from app.db.profiles import ProfileRecord
from app.db.subscriptions import SubscriptionTierRecord
from app.services.admin import AdminService
from app.services.email import EmailMessage

TEST_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDazrjUk1XC+RxO
RKxIQyE8v8xz1MrwNqDmXfau6mlP5HNxG6kbyDwyk3wlvNsWcxn+drHogSVAq+ZY
aMRdvKvs0kpNvgExeEQNEdIBljjggqMiEadfptcCeNADku2yUd4QwRcLsAqucCF5
QShBpQWbvPF4J9TE5WVyAaJ4ltU2MdOE6oZhUCI/hKJ01Bv7W/utsIZ+jyj5Rnz0
5CcAdCcAgkCtdV7+EAWAISsvnrXhwVseIie67069hw+9zQvy20Use+jWjKKU3BxA
jgNmbs3tyefeiX/c/26EbTWugked+P8MtGiKKLmdYnCIS743mfPRDuGbPSFvHVmo
KErOejTHAgMBAAECggEASn4mnviqMf7tjBgFL3TrU+tYh/biQHXYwZUr7tEPmYuF
YfSw1iyNkgp0McTiMfpt1xxB5Y5SSHo9qcvBTsh1H+NYOK9/aIAxauGuRawHIShY
sbig6we6G7VV3GGhWxxUJhAW8Hu2pzy1qLpuIis0hZkF/IpS/dW7e9zim3t+izw6
J4VTMXVt//gkiwGumMdQ0yJ7o4RjVriAat5j0IAkuep7NI+lR+rPAfmDiG+vPtyy
pKSEtGpFz5/yceZh33Qd2OXEXNHZF2rd7NQVU5Z8AOxnY6eTml4l3jjVT5gAL4n6
OcN6ZVr/11p6/VhlX3m8MlWVk4iB9NEARIXcN+onwQKBgQD2NZ0R4FwkjttKuHk8
JghnadniG6BtCbewDxGkKTuObd2C6f2izfvntZ1M0X9uymNh7WbjDyH5zNv6LYTi
kEUKygOgo9+Z2aBFH7ceqPXkN/7GUzanKgJB7xkMC4cKoE+2wKolXza/HdTydXI4
DqEiyP83S3eUhoEtUEF1js+1IwKBgQDjgijkUR+wV3a3EY5CBP0v6Uve+Ixw6Imr
iiN7+CDDOy1yyGRBMgFP2mN+4nH7v8FFoqbIpzlvFAho+pByv94hRMfNibZrqmQT
EfJQUiCGTysjkBvIECKHlolznSNCx2OYHFYIUkLI/zRuGrRo+Pn3uEal5JV7UNk/
GMWwSH8WDQKBgCrwstI5VRizKZ/giJRq9bBDj9KViuc5eKXmGueMoWx30NhSQwAv
+K0yyZpqN1V1Stv7caRMMVrF1d/OLIzvKHt3PCa6LfdBM2ia3W8lfK0u7upb/P4u
n3IsZyvonsbFquFuvL4D2yJ963PV8/O+6W+NqqVULijjRIhIpQIBxEwNAoGBAINI
hsRJs9mUfyLg9JBQRLIzE98U2iYFafwc+KD+7Bj8uxszW/brHiqwQR3lGhVF8Ad4
9nlvVgstKjU58cTlxw63m/yVbTjv2FPQ1V1YJwCaCrC45e8qsGJBkguvL7vHR0dt
go/GuFc4PU8UBetVURmLsujj4QaJ/vMUHm+9Rei5AoGAQ3wSyYTPf8IG/oFBihNk
cOHYtbjNU1Vdf8ba4XUPswo/nHKV0kyQDkppb+22qyzi7F+85jTH44uSxwj6c5lb
iCPhk+xR4LYoNxYpCicW8DDsrHZjkmDv04mrTOQp/PdjtU6qZPNkYNQNM8JbP/j7
PhyreqLGV8+glSysPzaL6Nk=
-----END PRIVATE KEY-----"""

TEST_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2s641JNVwvkcTkSsSEMh
PL/Mc9TK8Dag5l32ruppT+RzcRupG8g8MpN8JbzbFnMZ/nax6IElQKvmWGjEXbyr
7NJKTb4BMXhEDRHSAZY44IKjIhGnX6bXAnjQA5LtslHeEMEXC7AKrnAheUEoQaUF
m7zxeCfUxOVlcgGieJbVNjHThOqGYVAiP4SidNQb+1v7rbCGfo8o+UZ89OQnAHQn
AIJArXVe/hAFgCErL5614cFbHiInuu9OvYcPvc0L8ttFLHvo1oyilNwcQI4DZm7N
7cnn3ol/3P9uhG01roJHnfj/DLRoiii5nWJwiEu+N5nz0Q7hmz0hbx1ZqChKzno0
xwIDAQAB
-----END PUBLIC KEY-----"""


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

    def fetch_user(self, *, user_id: str):
        return None

    def update_user(self, *, user_id: str, updates: dict[str, object]):
        return updates


class StubSubscriptionRepository:
    def __init__(self) -> None:
        self.tiers = {
            "basic": SubscriptionTierRecord(
                key="basic",
                name="Basic",
                monthly_resume_generation_limit=10,
                generation_model="openai/gpt-5-mini",
                generation_fallback_model="google/gemini-flash-1.5",
                is_active=True,
                created_at="2026-05-23T00:00:00+00:00",
                updated_at="2026-05-23T00:00:00+00:00",
            ),
            "pro": SubscriptionTierRecord(
                key="pro",
                name="Pro",
                monthly_resume_generation_limit=100,
                generation_model="z-ai/glm-5.1",
                generation_fallback_model="anthropic/claude-sonnet-4.6",
                is_active=True,
                created_at="2026-05-23T00:00:00+00:00",
                updated_at="2026-05-23T00:00:00+00:00",
            ),
        }
        self.updated: tuple[str, int, str, str] | None = None

    def list_tiers(self):
        return list(self.tiers.values())

    def fetch_tier(self, *, tier_key: str):
        return self.tiers.get(tier_key)

    def update_tier(
        self,
        *,
        tier_key: str,
        monthly_resume_generation_limit: int,
        generation_model: str,
        generation_fallback_model: str,
    ):
        self.updated = (
            tier_key,
            monthly_resume_generation_limit,
            generation_model,
            generation_fallback_model,
        )
        current = self.tiers[tier_key]
        updated = current.model_copy(
            update={
                "monthly_resume_generation_limit": monthly_resume_generation_limit,
                "generation_model": generation_model,
                "generation_fallback_model": generation_fallback_model,
                "updated_at": "2026-05-23T12:00:00+00:00",
            }
        )
        self.tiers[tier_key] = updated
        return updated


class StubProfileRepository:
    def __init__(self, existing_profile: Optional[ProfileRecord] = None) -> None:
        self._existing_profile = existing_profile
        self.update_calls = 0

    def fetch_profile_by_email(self, email: str) -> Optional[ProfileRecord]:
        return self._existing_profile

    def upsert_profile(self, user_id: str, updates: dict[str, object]) -> Optional[ProfileRecord]:
        self.update_calls += 1
        return None


class StubUserManager:
    def __init__(self, *, user_id: str = "user-123") -> None:
        self.user_id = user_id
        self.create_user_calls = 0

    def create_user(self, *, email: str, password: str) -> str:
        self.create_user_calls += 1
        return self.user_id

    def set_user_password(self, *, user_id: str, password: str) -> None:
        pass

    def update_user_email(self, *, user_id: str, email: str) -> None:
        pass

    def deactivate_user(self, *, user_id: str) -> None:
        pass

    def reactivate_user(self, *, user_id: str) -> None:
        pass

    def delete_user(self, *, user_id: str) -> None:
        pass


class FailingEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        raise RuntimeError("resend failed")


class SuccessfulEmailSender:
    async def send(self, message: EmailMessage) -> Optional[str]:
        return "email_1"


def _make_settings():
    return Settings(
        JWT_PRIVATE_KEY=TEST_PRIVATE_KEY,
        JWT_PUBLIC_KEY=TEST_PUBLIC_KEY,
    )


@pytest.mark.asyncio
async def test_invite_user_fails_closed_when_email_notifications_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "false")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    repository = StubAdminRepository()
    profiles = StubProfileRepository()
    user_manager = StubUserManager()
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=profiles,  # type: ignore[arg-type]
        subscription_repository=StubSubscriptionRepository(),  # type: ignore[arg-type]
        user_manager=user_manager,  # type: ignore[arg-type]
        email_sender=SuccessfulEmailSender(),  # type: ignore[arg-type]
        settings=_make_settings(),
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
    assert user_manager.create_user_calls == 0
    assert profiles.update_calls == 0


@pytest.mark.asyncio
async def test_invite_user_records_failure_when_email_delivery_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EMAIL_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")

    repository = StubAdminRepository()
    profiles = StubProfileRepository()
    user_manager = StubUserManager(user_id="invitee-1")
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=profiles,  # type: ignore[arg-type]
        subscription_repository=StubSubscriptionRepository(),  # type: ignore[arg-type]
        user_manager=user_manager,  # type: ignore[arg-type]
        email_sender=FailingEmailSender(),  # type: ignore[arg-type]
        settings=_make_settings(),
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


def test_update_subscription_tier_validates_and_persists_values():
    repository = StubAdminRepository()
    subscriptions = StubSubscriptionRepository()
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=StubProfileRepository(),  # type: ignore[arg-type]
        subscription_repository=subscriptions,  # type: ignore[arg-type]
        user_manager=StubUserManager(),  # type: ignore[arg-type]
        email_sender=SuccessfulEmailSender(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    updated = service.update_subscription_tier(
        tier_key="basic",
        monthly_resume_generation_limit=12,
        generation_model="openai/gpt-5-mini",
        generation_fallback_model="google/gemini-flash-1.5",
    )

    assert updated.monthly_resume_generation_limit == 12
    assert subscriptions.updated == (
        "basic",
        12,
        "openai/gpt-5-mini",
        "google/gemini-flash-1.5",
    )


def test_update_subscription_tier_rejects_excessive_limits_and_malformed_models():
    repository = StubAdminRepository()
    subscriptions = StubSubscriptionRepository()
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=StubProfileRepository(),  # type: ignore[arg-type]
        subscription_repository=subscriptions,  # type: ignore[arg-type]
        user_manager=StubUserManager(),  # type: ignore[arg-type]
        email_sender=SuccessfulEmailSender(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    with pytest.raises(ValueError, match="cannot exceed"):
        service.update_subscription_tier(
            tier_key="basic",
            monthly_resume_generation_limit=10_001,
            generation_model="openai/gpt-5-mini",
            generation_fallback_model="google/gemini-flash-1.5",
        )

    with pytest.raises(ValueError, match="provider/model"):
        service.update_subscription_tier(
            tier_key="basic",
            monthly_resume_generation_limit=12,
            generation_model="not-a-model-id",
            generation_fallback_model="google/gemini-flash-1.5",
        )


@pytest.mark.asyncio
async def test_update_user_rejects_inactive_subscription_tier_assignment():
    repository = StubAdminRepository()
    subscriptions = StubSubscriptionRepository()
    subscriptions.tiers["pro"] = subscriptions.tiers["pro"].model_copy(update={"is_active": False})
    service = AdminService(
        repository=repository,  # type: ignore[arg-type]
        profile_repository=StubProfileRepository(),  # type: ignore[arg-type]
        subscription_repository=subscriptions,  # type: ignore[arg-type]
        user_manager=StubUserManager(),  # type: ignore[arg-type]
        email_sender=SuccessfulEmailSender(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    with pytest.raises(ValueError, match="Subscription tier is inactive"):
        await service.update_user(target_user_id="user-1", updates={"subscription_tier": "pro"})
