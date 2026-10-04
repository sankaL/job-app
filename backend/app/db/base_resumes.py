from __future__ import annotations

from contextlib import contextmanager
from typing import Optional

from psycopg import sql
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.db.connection import rls_connection


class BaseResumeListRecord(BaseModel):
    summary_md: str = ""
    legacy_content_md: Optional[str] = None
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
    document: Optional[dict] = None
    revision: int = 1
    raw_source_md: Optional[str] = None
    import_warning: Optional[str] = None
    contact_suggestions: dict[str, str] = Field(default_factory=dict)
    created_at: str
    updated_at: str


@contextmanager
def _resume_name_conflict():
    try:
        yield
    except UniqueViolation as error:
        if error.diag.constraint_name != "base_resumes_user_name_unique":
            raise
        raise PermissionError("You already have a resume with this name. Choose a different name.") from error


class BaseResumeRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _connection(self, *, user_id: str):
        return rls_connection(self.database_url, user_id=user_id)

    def list_resumes(self, user_id: str) -> list[BaseResumeListRecord]:
        query = """
        select
          id::text,
          name,
          user_id::text,
          coalesce((
            select section->>'content_md'
            from jsonb_array_elements(document->'sections') as section
            where section->>'kind' = 'summary'
              and btrim(section->>'content_md') <> ''
            limit 1
          ), '') as summary_md,
          case when document is null then content_md end as legacy_content_md,
          created_at::text,
          updated_at::text
        from public.base_resumes
        where user_id = %s
        order by updated_at desc
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id,))
            rows = cursor.fetchall()

        return [BaseResumeListRecord.model_validate(row) for row in rows]

    def create_resume(
        self,
        *,
        user_id: str,
        name: str,
        content_md: str,
        document: Optional[dict] = None,
        raw_source_md: Optional[str] = None,
        import_warning: Optional[str] = None,
        contact_suggestions: Optional[dict[str, str]] = None,
    ) -> BaseResumeRecord:
        query = """
        insert into public.base_resumes (
          user_id,
          name,
          content_md,
          document,
          raw_source_md,
          import_warning,
          contact_suggestions
        )
        values (%s, %s, %s, %s, %s, %s, %s)
        returning
          id::text,
          name,
          user_id::text,
          content_md,
          document,
          revision,
          raw_source_md,
          import_warning,
          contact_suggestions,
          created_at::text,
          updated_at::text
        """

        with _resume_name_conflict(), self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, name, content_md, Jsonb(document) if document else None, raw_source_md, import_warning, Jsonb(contact_suggestions or {})))
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
          document,
          revision,
          raw_source_md,
          import_warning,
          contact_suggestions,
          created_at::text,
          updated_at::text
        from public.base_resumes
        where user_id = %s and id = %s
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, resume_id))
            row = cursor.fetchone()

        return BaseResumeRecord.model_validate(row) if row else None

    def update_resume(
        self,
        resume_id: str,
        user_id: str,
        updates: dict,
        *,
        expected_revision: Optional[int] = None,
    ) -> BaseResumeRecord:
        if not updates:
            existing = self.fetch_resume(user_id, resume_id)
            if existing is None:
                raise LookupError("Base resume not found.")
            return existing

        allowed_fields = {"name", "content_md", "document", "raw_source_md", "import_warning", "contact_suggestions"}
        if not set(updates).issubset(allowed_fields):
            raise ValueError("Unsupported base resume update field.")
        assignments = [
            sql.SQL("{} = {}").format(sql.Identifier(field), sql.SQL("%s"))
            for field in updates
        ]
        assignments.append(sql.SQL("revision = revision + 1"))
        values = [Jsonb(value) if field in {"document", "contact_suggestions"} and value is not None else value for field, value in updates.items()]
        revision_predicate = sql.SQL(" and revision = %s") if expected_revision is not None else sql.SQL("")
        update_query = sql.SQL(
            """
            update public.base_resumes
            set {assignments}
            where id = %s and user_id = %s {revision_predicate}
            returning
              id::text,
              name,
              user_id::text,
              content_md,
              document,
              revision,
              raw_source_md,
              import_warning,
              contact_suggestions,
              created_at::text,
              updated_at::text
            """
        ).format(assignments=sql.SQL(", ").join(assignments), revision_predicate=revision_predicate)

        with _resume_name_conflict(), self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            parameters = (*values, resume_id, user_id)
            if expected_revision is not None:
                parameters += (expected_revision,)
            cursor.execute(update_query, parameters)
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            if expected_revision is not None and self.fetch_resume(user_id, resume_id) is not None:
                raise PermissionError("This resume changed while you were editing. Reload it before saving.")
            raise LookupError("Base resume not found.")

        return BaseResumeRecord.model_validate(row)

    def delete_resume(self, resume_id: str, user_id: str) -> bool:
        clear_profile_default_query = """
        update public.profiles
        set default_base_resume_id = null
        where id = %s and default_base_resume_id = %s
        """
        clear_application_references_query = """
        update public.applications
        set base_resume_id = null
        where user_id = %s and base_resume_id = %s
        """
        query = """
        delete from public.base_resumes
        where id = %s and user_id = %s
        returning id::text
        """

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(clear_profile_default_query, (user_id, resume_id))
            cursor.execute(clear_application_references_query, (user_id, resume_id))
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

        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, resume_id))
            row = cursor.fetchone()

        return row is not None


def get_base_resume_repository() -> BaseResumeRepository:
    return BaseResumeRepository(get_settings().database_url)
