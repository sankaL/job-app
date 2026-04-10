from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Optional

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.config import get_settings


class ProfileRecord(BaseModel):
    id: str
    email: str
    name: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    linkedin_url: Optional[str]
    default_base_resume_id: Optional[str]
    section_preferences: dict[str, bool]
    section_order: list[str]
    created_at: str
    updated_at: str


class ExtensionConnectionRecord(BaseModel):
    connected: bool
    token_created_at: Optional[str]
    token_last_used_at: Optional[str]


class ExtensionTokenOwnerRecord(BaseModel):
    id: str
    email: str


class ProfileRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def fetch_profile(self, user_id: str) -> Optional[ProfileRecord]:
        query = """
        select
          id::text,
          email,
          name,
          phone,
          address,
          linkedin_url,
          default_base_resume_id::text,
          section_preferences,
          section_order,
          created_at::text,
          updated_at::text
        from public.profiles
        where id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()

        return ProfileRecord.model_validate(row) if row else None

    def fetch_extension_connection(self, user_id: str) -> Optional[ExtensionConnectionRecord]:
        query = """
        select
          (extension_token_hash is not null) as connected,
          extension_token_created_at::text as token_created_at,
          extension_token_last_used_at::text as token_last_used_at
        from public.profiles
        where id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()

        return ExtensionConnectionRecord.model_validate(row) if row else None

    def fetch_extension_owner_by_token_hash(self, token_hash: str) -> Optional[ExtensionTokenOwnerRecord]:
        query = """
        select
          id::text,
          email
        from public.profiles
        where extension_token_hash = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (token_hash,))
            row = cursor.fetchone()

        return ExtensionTokenOwnerRecord.model_validate(row) if row else None

    def upsert_extension_token(self, *, user_id: str, token_hash: str) -> ExtensionConnectionRecord:
        query = """
        update public.profiles
        set
          extension_token_hash = %s,
          extension_token_created_at = now(),
          extension_token_last_used_at = null
        where id = %s
        returning
          (extension_token_hash is not null) as connected,
          extension_token_created_at::text as token_created_at,
          extension_token_last_used_at::text as token_last_used_at
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (token_hash, user_id))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise LookupError("Authenticated profile is unavailable.")
        return ExtensionConnectionRecord.model_validate(row)

    def clear_extension_token(self, *, user_id: str) -> ExtensionConnectionRecord:
        query = """
        update public.profiles
        set
          extension_token_hash = null,
          extension_token_created_at = null,
          extension_token_last_used_at = null
        where id = %s
        returning
          (extension_token_hash is not null) as connected,
          extension_token_created_at::text as token_created_at,
          extension_token_last_used_at::text as token_last_used_at
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise LookupError("Authenticated profile is unavailable.")
        return ExtensionConnectionRecord.model_validate(row)

    def touch_extension_token(self, *, user_id: str) -> None:
        query = """
        update public.profiles
        set extension_token_last_used_at = now()
        where id = %s and extension_token_hash is not null
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            connection.commit()

    def update_profile(
        self,
        user_id: str,
        updates: dict[str, Any],
    ) -> Optional[ProfileRecord]:
        if not updates:
            return self.fetch_profile(user_id)

        assignments = [
            sql.SQL("{} = {}").format(sql.Identifier(field), self._cast_placeholder(field))
            for field in updates
        ]
        values = [self._prepare_value(field, value) for field, value in updates.items()]
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

        if row is None or row.get("id") is None:
            return None

        return self.fetch_profile(user_id)

    def _prepare_value(self, field_name: str, value: Any) -> Any:
        if value is None:
            return None

        jsonb_fields = {"section_preferences", "section_order"}
        if field_name in jsonb_fields:
            return Jsonb(value)

        return value

    def _cast_placeholder(self, field_name: str) -> sql.SQL:
        jsonb_fields = {"section_preferences", "section_order"}
        if field_name in jsonb_fields:
            return sql.SQL("%s::jsonb")
        return sql.SQL("%s")

    def update_default_resume(self, user_id: str, resume_id: Optional[str]) -> None:
        query = """
        update public.profiles
        set default_base_resume_id = %s
        where id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (resume_id, user_id))
            connection.commit()

    def fetch_default_resume_id(self, user_id: str) -> Optional[str]:
        query = """
        select default_base_resume_id::text
        from public.profiles
        where id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()

        if row is None:
            return None
        return row.get("default_base_resume_id")


def get_profile_repository() -> ProfileRepository:
    return ProfileRepository(get_settings().database_url)
