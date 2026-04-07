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


def get_profile_repository() -> ProfileRepository:
    return ProfileRepository(get_settings().database_url)
