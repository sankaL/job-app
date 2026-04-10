from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Optional

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.config import get_settings


class AdminUserRecord(BaseModel):
    id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    linkedin_url: Optional[str] = None
    is_admin: bool
    is_active: bool
    onboarding_completed_at: Optional[str] = None
    latest_invite_status: Optional[str] = None
    latest_invite_sent_at: Optional[str] = None
    latest_invite_expires_at: Optional[str] = None
    created_at: str
    updated_at: str


class InviteRecord(BaseModel):
    id: str
    invitee_user_id: str
    invited_by_user_id: str
    invited_email: str
    status: str
    expires_at: str
    sent_at: str
    accepted_at: Optional[str] = None
    created_at: str
    updated_at: str


class InviteValidationRecord(BaseModel):
    id: str
    invitee_user_id: str
    invited_by_user_id: str
    invited_email: str
    status: str
    expires_at: str
    sent_at: str
    accepted_at: Optional[str] = None
    profile_is_active: bool


class OperationMetricRecord(BaseModel):
    event_type: str
    total: int
    success_count: int
    failure_count: int


class AdminRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def list_users(
        self,
        *,
        search: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[AdminUserRecord]:
        conditions = ["1=1"]
        params: list[Any] = []

        if search:
            conditions.append(
                "(coalesce(p.email, '') || ' ' || coalesce(p.name, '') || ' ' || coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) ilike %s"
            )
            params.append(f"%{search.strip()}%")

        if status == "active":
            conditions.append("p.is_active = true and p.onboarding_completed_at is not null")
        elif status == "invited":
            conditions.append("p.is_active = true and p.onboarding_completed_at is null")
        elif status == "deactivated":
            conditions.append("p.is_active = false")

        query = f"""
        select
          p.id::text,
          p.email,
          p.first_name,
          p.last_name,
          p.name,
          p.phone,
          p.address,
          p.linkedin_url,
          p.is_admin,
          p.is_active,
          p.onboarding_completed_at::text,
          li.status::text as latest_invite_status,
          li.sent_at::text as latest_invite_sent_at,
          li.expires_at::text as latest_invite_expires_at,
          p.created_at::text,
          p.updated_at::text
        from public.profiles p
        left join lateral (
          select
            ui.status,
            ui.sent_at,
            ui.expires_at
          from public.user_invites ui
          where ui.invitee_user_id = p.id
          order by ui.created_at desc
          limit 1
        ) li on true
        where {' and '.join(conditions)}
        order by p.created_at desc
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()

        return [AdminUserRecord.model_validate(row) for row in rows]

    def fetch_user(self, *, user_id: str) -> Optional[AdminUserRecord]:
        query = """
        select
          p.id::text,
          p.email,
          p.first_name,
          p.last_name,
          p.name,
          p.phone,
          p.address,
          p.linkedin_url,
          p.is_admin,
          p.is_active,
          p.onboarding_completed_at::text,
          li.status::text as latest_invite_status,
          li.sent_at::text as latest_invite_sent_at,
          li.expires_at::text as latest_invite_expires_at,
          p.created_at::text,
          p.updated_at::text
        from public.profiles p
        left join lateral (
          select
            ui.status,
            ui.sent_at,
            ui.expires_at
          from public.user_invites ui
          where ui.invitee_user_id = p.id
          order by ui.created_at desc
          limit 1
        ) li on true
        where p.id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()

        return AdminUserRecord.model_validate(row) if row else None

    def update_user(self, *, user_id: str, updates: dict[str, Any]) -> AdminUserRecord:
        normalized_updates = dict(updates)
        if "first_name" in normalized_updates or "last_name" in normalized_updates:
            if "name" not in normalized_updates:
                current = self.fetch_user(user_id=user_id)
                if current is None:
                    raise LookupError("User not found.")
                first_name = normalized_updates.get("first_name", current.first_name)
                last_name = normalized_updates.get("last_name", current.last_name)
                normalized_updates["name"] = self._derive_full_name(
                    first_name=first_name,
                    last_name=last_name,
                )

        if not normalized_updates:
            current = self.fetch_user(user_id=user_id)
            if current is None:
                raise LookupError("User not found.")
            return current

        assignments = [
            sql.SQL("{} = {}").format(sql.Identifier(field), self._cast_placeholder(field))
            for field in normalized_updates
        ]
        values = [
            self._prepare_value(field, value)
            for field, value in normalized_updates.items()
        ]

        update_query = sql.SQL(
            """
            update public.profiles
            set {assignments}
            where id = %s
            returning id::text
            """
        ).format(assignments=sql.SQL(", ").join(assignments))

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(update_query, (*values, user_id))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise LookupError("User not found.")

        updated = self.fetch_user(user_id=user_id)
        if updated is None:
            raise LookupError("User not found.")
        return updated

    def revoke_pending_invites(self, *, invitee_user_id: str) -> None:
        query = """
        update public.user_invites
        set status = 'revoked'::public.invite_status_enum
        where invitee_user_id = %s and status = 'pending'::public.invite_status_enum
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (invitee_user_id,))
            connection.commit()

    def create_invite(
        self,
        *,
        invitee_user_id: str,
        invited_by_user_id: str,
        invited_email: str,
        token_hash: str,
        expires_at: str,
    ) -> InviteRecord:
        query = """
        insert into public.user_invites (
          invitee_user_id,
          invited_by_user_id,
          invited_email,
          token_hash,
          status,
          expires_at
        )
        values (%s, %s, %s, %s, 'pending'::public.invite_status_enum, %s::timestamptz)
        returning
          id::text,
          invitee_user_id::text,
          invited_by_user_id::text,
          invited_email,
          status::text,
          expires_at::text,
          sent_at::text,
          accepted_at::text,
          created_at::text,
          updated_at::text
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                query,
                (invitee_user_id, invited_by_user_id, invited_email, token_hash, expires_at),
            )
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise RuntimeError("Invite insert did not return a record.")
        return InviteRecord.model_validate(row)

    def fetch_invite_by_token_hash(self, *, token_hash: str) -> Optional[InviteValidationRecord]:
        query = """
        select
          ui.id::text,
          ui.invitee_user_id::text,
          ui.invited_by_user_id::text,
          ui.invited_email,
          ui.status::text,
          ui.expires_at::text,
          ui.sent_at::text,
          ui.accepted_at::text,
          p.is_active as profile_is_active
        from public.user_invites ui
        join public.profiles p on p.id = ui.invitee_user_id
        where ui.token_hash = %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (token_hash,))
            row = cursor.fetchone()
        return InviteValidationRecord.model_validate(row) if row else None

    def mark_invite_status(self, *, invite_id: str, status: str) -> None:
        query = """
        update public.user_invites
        set status = %s::public.invite_status_enum
        where id = %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (status, invite_id))
            connection.commit()

    def mark_invite_accepted(self, *, invite_id: str) -> None:
        query = """
        update public.user_invites
        set
          status = 'accepted'::public.invite_status_enum,
          accepted_at = now()
        where id = %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (invite_id,))
            connection.commit()

    def create_usage_event(
        self,
        *,
        user_id: str,
        event_type: str,
        event_status: str,
        application_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        query = """
        insert into public.usage_events (
          user_id,
          application_id,
          event_type,
          event_status,
          metadata
        )
        values (%s, %s, %s, %s::public.usage_event_status_enum, %s::jsonb)
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    user_id,
                    application_id,
                    event_type,
                    event_status,
                    Jsonb(metadata or {}),
                ),
            )
            connection.commit()

    def get_user_counts(self) -> dict[str, int]:
        query = """
        select
          count(*)::int as total_users,
          count(*) filter (where is_active = true)::int as active_users,
          count(*) filter (where is_active = false)::int as deactivated_users,
          count(*) filter (where is_active = true and onboarding_completed_at is null)::int as invited_users
        from public.profiles
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
        return {
            "total_users": int(row["total_users"]),
            "active_users": int(row["active_users"]),
            "deactivated_users": int(row["deactivated_users"]),
            "invited_users": int(row["invited_users"]),
        }

    def get_invite_counts(self) -> dict[str, int]:
        query = """
        select
          count(*)::int as invites_sent,
          count(*) filter (where status = 'accepted'::public.invite_status_enum)::int as invites_accepted,
          count(*) filter (where status = 'pending'::public.invite_status_enum)::int as invites_pending
        from public.user_invites
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
        return {
            "invites_sent": int(row["invites_sent"]),
            "invites_accepted": int(row["invites_accepted"]),
            "invites_pending": int(row["invites_pending"]),
        }

    def get_total_applications(self) -> int:
        query = "select count(*)::int as total_applications from public.applications"
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
        return int(row["total_applications"])

    def get_operation_metrics(self) -> list[OperationMetricRecord]:
        query = """
        select
          event_type,
          count(*)::int as total,
          count(*) filter (where event_status = 'success'::public.usage_event_status_enum)::int as success_count,
          count(*) filter (where event_status = 'failure'::public.usage_event_status_enum)::int as failure_count
        from public.usage_events
        where event_type in ('extraction', 'generation', 'regeneration', 'export')
        group by event_type
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()
        return [OperationMetricRecord.model_validate(row) for row in rows]

    @staticmethod
    def _derive_full_name(*, first_name: Optional[str], last_name: Optional[str]) -> Optional[str]:
        parts = []
        if isinstance(first_name, str) and first_name.strip():
            parts.append(first_name.strip())
        if isinstance(last_name, str) and last_name.strip():
            parts.append(last_name.strip())
        if not parts:
            return None
        return " ".join(parts)

    @staticmethod
    def _prepare_value(field_name: str, value: Any) -> Any:
        if value is None:
            return None
        if field_name in {"metadata"}:
            return Jsonb(value)
        return value

    @staticmethod
    def _cast_placeholder(field_name: str) -> sql.SQL:
        if field_name in {"metadata"}:
            return sql.SQL("%s::jsonb")
        return sql.SQL("%s")


def get_admin_repository() -> AdminRepository:
    return AdminRepository(get_settings().database_url)
