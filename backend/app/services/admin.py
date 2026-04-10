from __future__ import annotations

import hashlib
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db.admin import AdminRepository, AdminUserRecord, get_admin_repository
from app.db.profiles import ProfileRepository, get_profile_repository
from app.services.email import EmailMessage, EmailSender, build_email_sender
from app.services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, build_supabase_admin_client

logger = logging.getLogger(__name__)


class AdminOperationMetric(BaseModel):
    total: int
    success_count: int
    failure_count: int
    success_rate: float


class AdminMetricsPayload(BaseModel):
    total_users: int
    active_users: int
    deactivated_users: int
    invited_users: int
    total_applications: int
    invites_sent: int
    invites_accepted: int
    invites_pending: int
    extraction: AdminOperationMetric
    generation: AdminOperationMetric
    regeneration: AdminOperationMetric
    export: AdminOperationMetric


class InviteResultPayload(BaseModel):
    invite_id: str
    invitee_user_id: str
    invited_email: str
    expires_at: str


class InvitePreviewPayload(BaseModel):
    invited_email: str
    expires_at: str


class InviteAcceptResult(BaseModel):
    user_id: str
    email: str


PASSWORD_MIN_LENGTH = 12
PASSWORD_UPPERCASE_PATTERN = re.compile(r"[A-Z]")
PASSWORD_LOWERCASE_PATTERN = re.compile(r"[a-z]")
PASSWORD_DIGIT_PATTERN = re.compile(r"\d")
PASSWORD_SYMBOL_PATTERN = re.compile(r"[^A-Za-z0-9]")


@dataclass
class AdminService:
    repository: AdminRepository
    profile_repository: ProfileRepository
    supabase_admin: SupabaseAdminClient
    email_sender: EmailSender
    settings: Settings

    def list_users(self, *, search: Optional[str], status: Optional[str]) -> list[AdminUserRecord]:
        return self.repository.list_users(search=search, status=status)

    def get_metrics(self) -> AdminMetricsPayload:
        user_counts = self.repository.get_user_counts()
        invite_counts = self.repository.get_invite_counts()
        total_applications = self.repository.get_total_applications()

        operation_rows = {row.event_type: row for row in self.repository.get_operation_metrics()}

        def build_operation(name: str) -> AdminOperationMetric:
            row = operation_rows.get(name)
            if row is None:
                return AdminOperationMetric(
                    total=0,
                    success_count=0,
                    failure_count=0,
                    success_rate=0.0,
                )
            success_rate = (row.success_count / row.total * 100.0) if row.total > 0 else 0.0
            return AdminOperationMetric(
                total=row.total,
                success_count=row.success_count,
                failure_count=row.failure_count,
                success_rate=round(success_rate, 2),
            )

        return AdminMetricsPayload(
            total_users=user_counts["total_users"],
            active_users=user_counts["active_users"],
            deactivated_users=user_counts["deactivated_users"],
            invited_users=user_counts["invited_users"],
            total_applications=total_applications,
            invites_sent=invite_counts["invites_sent"],
            invites_accepted=invite_counts["invites_accepted"],
            invites_pending=invite_counts["invites_pending"],
            extraction=build_operation("extraction"),
            generation=build_operation("generation"),
            regeneration=build_operation("regeneration"),
            export=build_operation("export"),
        )

    async def invite_user(
        self,
        *,
        invited_by_user_id: str,
        email: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
    ) -> InviteResultPayload:
        if not self.settings.email.notifications_enabled:
            raise ValueError(
                "Invite delivery is disabled. Enable email notifications before sending invites."
            )

        normalized_email = self._normalize_email(email)
        existing_profile = self.profile_repository.fetch_profile_by_email(normalized_email)

        if existing_profile is not None and existing_profile.onboarding_completed_at:
            raise ValueError("A user with this email already exists.")

        invitee_user_id: Optional[str] = existing_profile.id if existing_profile else None
        if invitee_user_id is None:
            temporary_password = secrets.token_urlsafe(24)
            try:
                invitee_user_id = await self.supabase_admin.create_user(
                    email=normalized_email,
                    password=temporary_password,
                    email_confirm=True,
                )
            except SupabaseAdminError as error:
                raise ValueError(str(error)) from error

        if invitee_user_id is None:
            raise RuntimeError("Invitee user ID is unavailable.")

        update_fields: dict[str, object] = {"is_active": True}
        if first_name is not None:
            update_fields["first_name"] = self._clean_optional_text(first_name)
        if last_name is not None:
            update_fields["last_name"] = self._clean_optional_text(last_name)
        if "first_name" in update_fields or "last_name" in update_fields:
            update_fields["name"] = self._join_name(
                first_name=update_fields.get("first_name"), last_name=update_fields.get("last_name")
            )
        self.profile_repository.update_profile(user_id=invitee_user_id, updates=update_fields)

        self.repository.revoke_pending_invites(invitee_user_id=invitee_user_id)

        invite_token = f"inv_{secrets.token_urlsafe(32)}"
        token_hash = self._hash_invite_token(invite_token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=self.settings.invite_link_expiry_hours)
        invite = self.repository.create_invite(
            invitee_user_id=invitee_user_id,
            invited_by_user_id=invited_by_user_id,
            invited_email=normalized_email,
            token_hash=token_hash,
            expires_at=expires_at.isoformat(),
        )

        invite_link = f"{self.settings.app_url.rstrip('/')}/signup?token={invite_token}"
        try:
            await self._send_invite_email(
                to_email=normalized_email,
                invite_link=invite_link,
                expires_at=invite.expires_at,
            )
        except Exception as error:
            logger.warning(
                "Invite email delivery failed for invitee_user_id=%s.",
                invitee_user_id,
            )
            self._record_usage_event(
                user_id=invitee_user_id,
                event_type="invite_sent",
                event_status="failure",
            )
            raise ValueError(
                "Invite email delivery failed. Confirm Resend configuration and sender setup."
            ) from error

        self._record_usage_event(
            user_id=invitee_user_id,
            event_type="invite_sent",
            event_status="success",
        )
        return InviteResultPayload(
            invite_id=invite.id,
            invitee_user_id=invite.invitee_user_id,
            invited_email=invite.invited_email,
            expires_at=invite.expires_at,
        )

    def preview_invite(self, *, token: str) -> InvitePreviewPayload:
        invite = self._require_pending_invite(token=token)
        return InvitePreviewPayload(
            invited_email=invite.invited_email,
            expires_at=invite.expires_at,
        )

    async def accept_invite(
        self,
        *,
        token: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        phone: str,
        address: str,
        linkedin_url: Optional[str],
    ) -> InviteAcceptResult:
        invite = self._require_pending_invite(token=token)
        normalized_email = self._normalize_email(email)
        if normalized_email != invite.invited_email.lower():
            raise PermissionError("Invite email mismatch.")

        self._validate_password_strength(password)

        try:
            await self.supabase_admin.set_user_password(
                user_id=invite.invitee_user_id,
                password=password,
            )
            await self.supabase_admin.unban_user(user_id=invite.invitee_user_id)
        except SupabaseAdminError as error:
            raise ValueError(str(error)) from error

        clean_first_name = self._require_non_blank(first_name, "First name")
        clean_last_name = self._require_non_blank(last_name, "Last name")
        clean_phone = self._require_non_blank(phone, "Phone")
        clean_address = self._require_non_blank(address, "Location")
        clean_linkedin = self._clean_optional_text(linkedin_url)

        self.profile_repository.update_profile(
            user_id=invite.invitee_user_id,
            updates={
                "first_name": clean_first_name,
                "last_name": clean_last_name,
                "name": self._join_name(first_name=clean_first_name, last_name=clean_last_name),
                "phone": clean_phone,
                "address": clean_address,
                "linkedin_url": clean_linkedin,
                "onboarding_completed_at": datetime.now(timezone.utc).isoformat(),
                "is_active": True,
            },
        )
        self.repository.mark_invite_accepted(invite_id=invite.id)
        self._record_usage_event(
            user_id=invite.invitee_user_id,
            event_type="invite_accepted",
            event_status="success",
        )
        return InviteAcceptResult(user_id=invite.invitee_user_id, email=normalized_email)

    async def update_user(
        self,
        *,
        target_user_id: str,
        updates: dict[str, object],
    ) -> AdminUserRecord:
        if not updates:
            existing = self.repository.fetch_user(user_id=target_user_id)
            if existing is None:
                raise LookupError("User not found.")
            return existing

        normalized_updates: dict[str, object] = {}

        if "email" in updates and updates["email"] is not None:
            email = self._normalize_email(str(updates["email"]))
            try:
                await self.supabase_admin.update_user_email(user_id=target_user_id, email=email)
            except SupabaseAdminError as error:
                raise ValueError(str(error)) from error
            normalized_updates["email"] = email

        for key in ("first_name", "last_name", "phone", "address", "linkedin_url"):
            if key in updates:
                value = updates[key]
                normalized_updates[key] = (
                    self._clean_optional_text(str(value)) if value is not None else None
                )

        if "first_name" in normalized_updates or "last_name" in normalized_updates:
            existing = self.repository.fetch_user(user_id=target_user_id)
            if existing is None:
                raise LookupError("User not found.")
            normalized_updates["name"] = self._join_name(
                first_name=normalized_updates.get("first_name", existing.first_name),
                last_name=normalized_updates.get("last_name", existing.last_name),
            )

        return self.repository.update_user(user_id=target_user_id, updates=normalized_updates)

    async def deactivate_user(self, *, actor_user_id: str, target_user_id: str) -> AdminUserRecord:
        if actor_user_id == target_user_id:
            raise PermissionError("You cannot deactivate your own account.")
        try:
            await self.supabase_admin.ban_user(user_id=target_user_id)
        except SupabaseAdminError as error:
            raise ValueError(str(error)) from error
        return self.repository.update_user(
            user_id=target_user_id,
            updates={"is_active": False},
        )

    async def reactivate_user(self, *, target_user_id: str) -> AdminUserRecord:
        try:
            await self.supabase_admin.unban_user(user_id=target_user_id)
        except SupabaseAdminError as error:
            raise ValueError(str(error)) from error
        return self.repository.update_user(
            user_id=target_user_id,
            updates={"is_active": True},
        )

    async def delete_user(self, *, actor_user_id: str, target_user_id: str) -> None:
        if actor_user_id == target_user_id:
            raise PermissionError("You cannot delete your own account.")
        try:
            await self.supabase_admin.delete_user(user_id=target_user_id)
        except SupabaseAdminError as error:
            raise ValueError(str(error)) from error

    def _require_pending_invite(self, *, token: str):
        clean_token = token.strip()
        if not clean_token:
            raise ValueError("Invite token is required.")
        token_hash = self._hash_invite_token(clean_token)
        invite = self.repository.fetch_invite_by_token_hash(token_hash=token_hash)
        if invite is None:
            raise LookupError("Invite not found.")
        if not invite.profile_is_active:
            raise PermissionError("This account has been deactivated.")
        if invite.status != "pending":
            raise PermissionError("Invite is no longer valid.")

        expires_at = self._parse_timestamp(invite.expires_at)
        if expires_at <= datetime.now(timezone.utc):
            self.repository.mark_invite_status(invite_id=invite.id, status="expired")
            raise PermissionError("Invite link has expired.")
        return invite

    async def _send_invite_email(self, *, to_email: str, invite_link: str, expires_at: str) -> None:
        expiry_label = self._parse_timestamp(expires_at).strftime("%B %d, %Y")
        html = (
            "<div style=\"font-family: 'Source Sans 3', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #101828;\">"
            "<div style=\"padding: 24px; border: 1px solid rgba(16,24,40,0.08); border-radius: 16px; background: #ffffff;\">"
            "<p style=\"margin: 0 0 8px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #184a45;\">Applix Invite</p>"
            "<h1 style=\"margin: 0 0 12px; font-size: 28px; line-height: 1.2;\">You're invited to Applix</h1>"
            "<p style=\"margin: 0 0 20px; font-size: 16px; line-height: 1.5;\">Finish your account setup and sign in to your invite-only workspace.</p>"
            f"<a href=\"{invite_link}\" style=\"display: inline-block; padding: 12px 18px; border-radius: 10px; background: #184a45; color: #ffffff; text-decoration: none; font-weight: 600;\">Accept Invite</a>"
            f"<p style=\"margin: 16px 0 0; font-size: 13px; color: rgba(16,24,40,0.65);\">This link expires on {expiry_label}.</p>"
            f"<p style=\"margin: 8px 0 0; font-size: 13px; color: rgba(16,24,40,0.65);\">If the button doesn't work, copy and paste this link:<br>{invite_link}</p>"
            "</div>"
            "</div>"
        )
        text = (
            "You're invited to Applix.\n\n"
            f"Accept invite: {invite_link}\n\n"
            f"This link expires on {expiry_label}."
        )
        await self.email_sender.send(
            EmailMessage(
                to=[to_email],
                subject="You are invited to Applix",
                html=html,
                text=text,
            )
        )

    def _record_usage_event(
        self,
        *,
        user_id: str,
        event_type: str,
        event_status: str,
    ) -> None:
        self.repository.create_usage_event(
            user_id=user_id,
            event_type=event_type,
            event_status=event_status,
        )

    @staticmethod
    def _normalize_email(email: str) -> str:
        cleaned = email.strip().lower()
        if not cleaned:
            raise ValueError("Email is required.")
        if "@" not in cleaned or cleaned.startswith("@") or cleaned.endswith("@"):
            raise ValueError("Email format is invalid.")
        return cleaned

    @staticmethod
    def _clean_optional_text(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @staticmethod
    def _require_non_blank(value: str, field_name: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError(f"{field_name} is required.")
        return stripped

    @staticmethod
    def _validate_password_strength(password: str) -> None:
        if len(password) < PASSWORD_MIN_LENGTH:
            raise ValueError("Password must be at least 12 characters long.")
        if PASSWORD_UPPERCASE_PATTERN.search(password) is None:
            raise ValueError("Password must include at least one uppercase letter.")
        if PASSWORD_LOWERCASE_PATTERN.search(password) is None:
            raise ValueError("Password must include at least one lowercase letter.")
        if PASSWORD_DIGIT_PATTERN.search(password) is None:
            raise ValueError("Password must include at least one number.")
        if PASSWORD_SYMBOL_PATTERN.search(password) is None:
            raise ValueError("Password must include at least one special character.")

    @staticmethod
    def _join_name(*, first_name: object, last_name: object) -> Optional[str]:
        parts: list[str] = []
        if isinstance(first_name, str) and first_name.strip():
            parts.append(first_name.strip())
        if isinstance(last_name, str) and last_name.strip():
            parts.append(last_name.strip())
        return " ".join(parts) if parts else None

    @staticmethod
    def _hash_invite_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_timestamp(value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed


def get_admin_service(
    repository: AdminRepository = Depends(get_admin_repository),
    profile_repository: ProfileRepository = Depends(get_profile_repository),
    settings: Settings = Depends(get_settings),
) -> AdminService:
    return AdminService(
        repository=repository,
        profile_repository=profile_repository,
        supabase_admin=build_supabase_admin_client(settings),
        email_sender=build_email_sender(settings),
        settings=settings,
    )
