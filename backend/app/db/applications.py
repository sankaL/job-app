from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Optional

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.core.config import get_settings


class ApplicationListRecord(BaseModel):
    id: str
    user_id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_posting_origin: Optional[str]
    visible_status: str
    internal_state: str
    failure_reason: Optional[str]
    applied: bool
    duplicate_similarity_score: Optional[float]
    duplicate_resolution_status: Optional[str]
    duplicate_matched_application_id: Optional[str]
    created_at: str
    updated_at: str
    base_resume_name: Optional[str]
    has_action_required_notification: bool


class ApplicationRecord(BaseModel):
    id: str
    user_id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_description: Optional[str]
    extracted_reference_id: Optional[str] = None
    job_posting_origin: Optional[str]
    job_posting_origin_other_text: Optional[str]
    base_resume_id: Optional[str]
    base_resume_name: Optional[str]
    visible_status: str
    internal_state: str
    failure_reason: Optional[str]
    extraction_failure_details: Optional[dict[str, Any]] = None
    applied: bool
    duplicate_similarity_score: Optional[float]
    duplicate_match_fields: Optional[dict[str, Any]]
    duplicate_resolution_status: Optional[str]
    duplicate_matched_application_id: Optional[str]
    notes: Optional[str]
    exported_at: Optional[str]
    created_at: str
    updated_at: str
    has_action_required_notification: bool


class DuplicateCandidateRecord(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    job_description: Optional[str]
    extracted_reference_id: Optional[str] = None
    job_posting_origin: Optional[str]
    job_posting_origin_other_text: Optional[str]


class MatchedApplicationRecord(BaseModel):
    id: str
    job_url: str
    job_title: Optional[str]
    company: Optional[str]
    visible_status: str


BASE_SELECT = """
select
  a.id::text,
  a.user_id::text,
  a.job_url,
  a.job_title,
  a.company,
  a.job_description,
  a.extracted_reference_id,
  a.job_posting_origin::text,
  a.job_posting_origin_other_text,
  a.base_resume_id::text,
  br.name as base_resume_name,
  a.visible_status::text,
  a.internal_state::text,
  a.failure_reason::text,
  a.extraction_failure_details,
  a.applied,
  a.duplicate_similarity_score::float8,
  a.duplicate_match_fields,
  a.duplicate_resolution_status::text,
  a.duplicate_matched_application_id::text,
  a.notes,
  a.exported_at::text,
  a.created_at::text,
  a.updated_at::text,
  exists(
    select 1
    from public.notifications n
    where n.user_id = a.user_id
      and n.application_id = a.id
      and n.action_required = true
  ) as has_action_required_notification
from public.applications a
left join public.base_resumes br on br.id = a.base_resume_id and br.user_id = a.user_id
"""

BASE_COLUMNS = BASE_SELECT.split("from public.applications a")[0].replace("select", "", 1).strip()


class ApplicationRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def list_applications(
        self,
        user_id: str,
        *,
        search: Optional[str] = None,
        visible_status: Optional[str] = None,
    ) -> list[ApplicationListRecord]:
        conditions = ["a.user_id = %s"]
        params: list[Any] = [user_id]

        if search:
            conditions.append("(coalesce(a.job_title, '') || ' ' || coalesce(a.company, '')) ilike %s")
            params.append(f"%{search.strip()}%")

        if visible_status:
            conditions.append("a.visible_status::text = %s")
            params.append(visible_status)

        query = f"""
        {BASE_SELECT}
        where {' and '.join(conditions)}
        order by a.updated_at desc
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()

        return [ApplicationListRecord.model_validate(row) for row in rows]

    def create_application(
        self,
        *,
        user_id: str,
        job_url: str,
        visible_status: str,
        internal_state: str,
    ) -> ApplicationRecord:
        query = """
        insert into public.applications (
          user_id,
          job_url,
          visible_status,
          internal_state
        )
        values (%s, %s, %s::public.visible_status_enum, %s::public.internal_state_enum)
        returning id::text
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, job_url, visible_status, internal_state))
            row = cursor.fetchone()
            connection.commit()

        if row is None or row.get("id") is None:
            raise RuntimeError("Application insert did not return an id.")

        created = self.fetch_application(user_id, row["id"])
        if created is None:
            raise RuntimeError("Created application could not be reloaded.")
        return created

    def fetch_application(self, user_id: str, application_id: str) -> Optional[ApplicationRecord]:
        query = f"""
        {BASE_SELECT}
        where a.user_id = %s and a.id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, application_id))
            row = cursor.fetchone()

        return ApplicationRecord.model_validate(row) if row else None

    def fetch_application_unscoped(self, application_id: str) -> Optional[ApplicationRecord]:
        query = f"""
        {BASE_SELECT}
        where a.id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (application_id,))
            row = cursor.fetchone()

        return ApplicationRecord.model_validate(row) if row else None

    def fetch_matched_application(
        self,
        *,
        user_id: str,
        application_id: str,
    ) -> Optional[MatchedApplicationRecord]:
        query = """
        select
          id::text,
          job_url,
          job_title,
          company,
          visible_status::text
        from public.applications
        where user_id = %s and id = %s
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, application_id))
            row = cursor.fetchone()

        return MatchedApplicationRecord.model_validate(row) if row else None

    def fetch_duplicate_candidates(
        self,
        *,
        user_id: str,
        exclude_application_id: str,
    ) -> list[DuplicateCandidateRecord]:
        query = """
        select
          id::text,
          job_url,
          job_title,
          company,
          job_description,
          extracted_reference_id,
          job_posting_origin::text,
          job_posting_origin_other_text
        from public.applications
        where user_id = %s
          and id <> %s
          and coalesce(duplicate_resolution_status::text, '') <> 'redirected'
        order by updated_at desc
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, exclude_application_id))
            rows = cursor.fetchall()

        return [DuplicateCandidateRecord.model_validate(row) for row in rows]

    def update_application(
        self,
        *,
        application_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> ApplicationRecord:
        if not updates:
            existing = self.fetch_application(user_id, application_id)
            if existing is None:
                raise LookupError("Application not found.")
            return existing

        assignments = [
            sql.SQL("{} = {}").format(sql.Identifier(field), self._cast_placeholder(field))
            for field in updates
        ]
        values = list(updates.values())
        update_query = sql.SQL(
            """
            update public.applications
            set {assignments}
            where id = %s and user_id = %s
            returning id::text
            """
        ).format(assignments=sql.SQL(", ").join(assignments))

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(update_query, (*values, application_id, user_id))
            row = cursor.fetchone()
            connection.commit()

        if row is None or row.get("id") is None:
            raise LookupError("Application not found.")

        updated = self.fetch_application(user_id, row["id"])
        if updated is None:
            raise LookupError("Application not found.")
        return updated

    def _cast_placeholder(self, field_name: str) -> sql.SQL:
        enum_casts = {
            "visible_status": "public.visible_status_enum",
            "internal_state": "public.internal_state_enum",
            "failure_reason": "public.failure_reason_enum",
            "job_posting_origin": "public.job_posting_origin_enum",
            "duplicate_resolution_status": "public.duplicate_resolution_status_enum",
        }
        if field_name in enum_casts:
            return sql.SQL("%s::{}").format(sql.SQL(enum_casts[field_name]))
        return sql.SQL("%s")


def get_application_repository() -> ApplicationRepository:
    return ApplicationRepository(get_settings().database_url)
