from __future__ import annotations

from contextlib import contextmanager
from typing import Optional

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.core.config import get_settings


class BaseResumeListRecord(BaseModel):
    id: str
    name: str
    user_id: str
    created_at: str
    updated_at: str


class BaseResumeRecord(BaseModel):
    id: str
    name: str
    user_id: str
    content_md: str
    created_at: str
    updated_at: str


class BaseResumeRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def list_resumes(self, user_id: str) -> list[BaseResumeListRecord]:
        query = """
        select
          id::text,
          name,
          user_id::text,
          created_at::text,
          updated_at::text
        from public.base_resumes
        where user_id = %s
        order by updated_at desc
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            rows = cursor.fetchall()

        return [BaseResumeListRecord.model_validate(row) for row in rows]

    def create_resume(
        self,
        *,
        user_id: str,
        name: str,
        content_md: str,
    ) -> BaseResumeRecord:
        query = """
        insert into public.base_resumes (
          user_id,
          name,
          content_md
        )
        values (%s, %s, %s)
        returning
          id::text,
          name,
          user_id::text,
          content_md,
          created_at::text,
          updated_at::text
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, name, content_md))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise RuntimeError("Base resume insert did not return a record.")

        return BaseResumeRecord.model_validate(row)

    def fetch_resume(self, user_id: str, resume_id: str) -> Optional[BaseResumeRecord]:
        query = """
        select
          id::text,
          name,
          user_id::text,
          content_md,
          created_at::text,
          updated_at::text
        from public.base_resumes
        where user_id = %s and id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, resume_id))
            row = cursor.fetchone()

        return BaseResumeRecord.model_validate(row) if row else None

    def update_resume(
        self,
        resume_id: str,
        user_id: str,
        updates: dict,
    ) -> BaseResumeRecord:
        if not updates:
            existing = self.fetch_resume(user_id, resume_id)
            if existing is None:
                raise LookupError("Base resume not found.")
            return existing

        assignments = [
            sql.SQL("{} = {}").format(sql.Identifier(field), sql.SQL("%s"))
            for field in updates
        ]
        values = list(updates.values())
        update_query = sql.SQL(
            """
            update public.base_resumes
            set {assignments}
            where id = %s and user_id = %s
            returning
              id::text,
              name,
              user_id::text,
              content_md,
              created_at::text,
              updated_at::text
            """
        ).format(assignments=sql.SQL(", ").join(assignments))

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(update_query, (*values, resume_id, user_id))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise LookupError("Base resume not found.")

        return BaseResumeRecord.model_validate(row)

    def delete_resume(self, resume_id: str, user_id: str) -> bool:
        query = """
        delete from public.base_resumes
        where id = %s and user_id = %s
        returning id::text
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (resume_id, user_id))
            row = cursor.fetchone()
            connection.commit()

        return row is not None and row.get("id") is not None

    def is_referenced(self, resume_id: str, user_id: str) -> bool:
        query = """
        select 1
        from public.applications
        where user_id = %s and base_resume_id = %s
        limit 1
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, resume_id))
            row = cursor.fetchone()

        return row is not None


def get_base_resume_repository() -> BaseResumeRepository:
    return BaseResumeRepository(get_settings().database_url)
