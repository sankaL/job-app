from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.config import get_settings
from app.db.connection import rls_connection


OUTCOMES_TIMEOUT_MESSAGE = "Workflow outcomes took too long to load. Try a shorter range."


class UsageEventRecord(BaseModel):
    id: str
    user_id: str
    application_id: Optional[str]
    event_type: str
    event_status: str
    metadata: dict[str, Any]
    created_at: str


class DailyOperationOutcomeRecord(BaseModel):
    local_date: date
    event_type: str
    success_count: int
    failure_count: int


class UsageEventRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _connection(self, *, user_id: Optional[str] = None, service: bool = False):
        return rls_connection(self.database_url, user_id=user_id, service=service)

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
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute("set local statement_timeout = '2s'")
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

    def list_application_events(
        self,
        *,
        user_id: str,
        application_id: str,
        limit: int = 200,
    ) -> list[UsageEventRecord]:
        query = """
        select
          id::text,
          user_id::text,
          application_id::text,
          event_type,
          event_status::text,
          metadata,
          created_at::text
        from public.usage_events
        where user_id = %s
          and application_id = %s
        order by created_at desc
        limit %s
        """
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, application_id, limit))
            rows = cursor.fetchall()

        return [UsageEventRecord.model_validate(row) for row in rows]

    def fetch_daily_operation_outcomes(
        self,
        *,
        timezone: str,
        start_at: datetime,
        end_before: datetime,
    ) -> list[DailyOperationOutcomeRecord]:
        """Admin aggregate of workflow outcomes per local day inside one bounded window."""
        query = """
        select
          (created_at at time zone %s)::date as local_date,
          event_type,
          count(*) filter (where event_status = 'success'::public.usage_event_status_enum)::int as success_count,
          count(*) filter (where event_status = 'failure'::public.usage_event_status_enum)::int as failure_count
        from public.usage_events
        where event_type in ('extraction', 'generation', 'regeneration', 'export')
          and created_at >= %s
          and created_at < %s
        group by local_date, event_type
        order by local_date, event_type
        """
        try:
            with self._connection(service=True) as connection, connection.cursor() as cursor:
                cursor.execute("set local statement_timeout = '5s'")
                cursor.execute(query, (timezone, start_at, end_before))
                rows = cursor.fetchall()
        except pg_errors.InvalidParameterValue as error:
            raise ValueError("Unsupported timezone.") from error
        except pg_errors.QueryCanceled as error:
            raise TimeoutError(OUTCOMES_TIMEOUT_MESSAGE) from error

        return [DailyOperationOutcomeRecord.model_validate(row) for row in rows]

    def fetch_earliest_operation_event_at(self) -> Optional[datetime]:
        query = """
        select min(created_at) as earliest_at
        from public.usage_events
        where event_type in ('extraction', 'generation', 'regeneration', 'export')
        """
        try:
            with self._connection(service=True) as connection, connection.cursor() as cursor:
                cursor.execute("set local statement_timeout = '5s'")
                cursor.execute(query)
                row = cursor.fetchone()
        except pg_errors.QueryCanceled as error:
            raise TimeoutError(OUTCOMES_TIMEOUT_MESSAGE) from error

        return row["earliest_at"] if row else None


def get_usage_event_repository() -> UsageEventRepository:
    return UsageEventRepository(get_settings().database_url)
