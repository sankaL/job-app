from __future__ import annotations

from contextlib import contextmanager
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.core.config import get_settings


class ProfileRecord(BaseModel):
    id: str
    email: str
    name: Optional[str]
    phone: Optional[str]
    address: Optional[str]
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


def get_profile_repository() -> ProfileRepository:
    return ProfileRepository(get_settings().database_url)
