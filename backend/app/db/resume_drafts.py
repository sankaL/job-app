from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel

from app.core.config import get_settings
from app.db.connection import rls_connection


class ResumeDraftRecord(BaseModel):
    id: str
    application_id: str
    user_id: str
    content_md: str
    generation_params: dict[str, Any]
    sections_snapshot: dict[str, Any]
    document: Optional[dict[str, Any]] = None
    source_snapshot: Optional[dict[str, Any]] = None
    revision: int = 1
    last_generated_at: str
    last_exported_at: Optional[str]
    updated_at: str


DRAFT_SELECT = """
select
  id::text,
  application_id::text,
  user_id::text,
  content_md,
  generation_params,
  sections_snapshot,
  document,
  source_snapshot,
  revision,
  last_generated_at::text,
  last_exported_at::text,
  updated_at::text
from public.resume_drafts
"""


class ResumeDraftRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _connection(self, *, user_id: str):
        return rls_connection(self.database_url, user_id=user_id)

    def fetch_draft(self, user_id: str, application_id: str) -> Optional[ResumeDraftRecord]:
        query = f"""
        {DRAFT_SELECT}
        where user_id = %s and application_id = %s
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, application_id))
            row = cursor.fetchone()

        return ResumeDraftRecord.model_validate(row) if row else None

    def upsert_draft(
        self,
        *,
        application_id: str,
        user_id: str,
        content_md: str,
        generation_params: dict[str, Any],
        sections_snapshot: dict[str, Any],
        document: Optional[dict[str, Any]] = None,
        source_snapshot: Optional[dict[str, Any]] = None,
    ) -> ResumeDraftRecord:
        query = """
        insert into public.resume_drafts (
          application_id,
          user_id,
          content_md,
          generation_params,
          sections_snapshot,
          document,
          source_snapshot,
          last_generated_at
        )
        values (%s, %s, %s, %s::jsonb, %s::jsonb, jsonb_set(%s::jsonb, '{revision}', '1'::jsonb), %s::jsonb, now())
        on conflict (application_id)
        do update set
          content_md = excluded.content_md,
          generation_params = excluded.generation_params,
          sections_snapshot = excluded.sections_snapshot,
          document = case when excluded.document is null then null else jsonb_set(excluded.document, '{revision}', to_jsonb(resume_drafts.revision + 1)) end,
          source_snapshot = excluded.source_snapshot,
          revision = resume_drafts.revision + 1,
          last_generated_at = now()
        where resume_drafts.user_id = %s
        returning
          id::text,
          application_id::text,
          user_id::text,
          content_md,
          generation_params,
          sections_snapshot,
          document,
          source_snapshot,
          revision,
          last_generated_at::text,
          last_exported_at::text,
          updated_at::text
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    application_id,
                    user_id,
                    content_md,
                    json.dumps(generation_params),
                    json.dumps(sections_snapshot),
                    json.dumps(document) if document is not None else None,
                    json.dumps(source_snapshot) if source_snapshot is not None else None,
                    user_id,  # for ON CONFLICT WHERE clause
                ),
            )
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise RuntimeError("Resume draft upsert did not return a record.")

        return ResumeDraftRecord.model_validate(row)

    def update_draft_content(
        self,
        *,
        application_id: str,
        user_id: str,
        content_md: str,
        document: Optional[dict[str, Any]] = None,
        expected_revision: Optional[int] = None,
    ) -> ResumeDraftRecord:
        query = """
        update public.resume_drafts
        set content_md = %s, document = case when %s::jsonb is null then null else jsonb_set(%s::jsonb, '{revision}', to_jsonb(revision + 1)) end, revision = revision + 1
        where application_id = %s and user_id = %s
          and (%s::integer is null or revision = %s)
        returning
          id::text,
          application_id::text,
          user_id::text,
          content_md,
          generation_params,
          sections_snapshot,
          document,
          source_snapshot,
          revision,
          last_generated_at::text,
          last_exported_at::text,
          updated_at::text
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            serialized = json.dumps(document) if document is not None else None
            cursor.execute(query, (content_md, serialized, serialized, application_id, user_id, expected_revision, expected_revision))
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            if expected_revision is not None and self.fetch_draft(user_id, application_id) is not None:
                raise PermissionError("This draft changed. Reload it before saving your edits.")
            raise LookupError("Resume draft not found.")

        return ResumeDraftRecord.model_validate(row)


    def update_exported_at(
        self,
        *,
        application_id: str,
        user_id: str,
    ) -> None:
        query = """
        update public.resume_drafts
        set last_exported_at = now()
        where application_id = %s and user_id = %s
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (application_id, user_id))
            connection.commit()


def get_resume_draft_repository() -> ResumeDraftRepository:
    return ResumeDraftRepository(get_settings().database_url)
