from __future__ import annotations

from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.core.config import get_settings


class NotificationRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def clear_action_required(self, *, user_id: str, application_id: str) -> None:
        query = """
        update public.notifications
        set action_required = false
        where user_id = %s and application_id = %s and action_required = true
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, application_id))
            connection.commit()

    def create_notification(
        self,
        *,
        user_id: str,
        application_id: str,
        notification_type: str,
        message: str,
        action_required: bool,
    ) -> None:
        query = """
        insert into public.notifications (
          user_id,
          application_id,
          type,
          message,
          action_required
        )
        values (%s, %s, %s::public.notification_type_enum, %s, %s)
        """

        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                query,
                (user_id, application_id, notification_type, message, action_required),
            )
            connection.commit()


def get_notification_repository() -> NotificationRepository:
    return NotificationRepository(get_settings().database_url)
