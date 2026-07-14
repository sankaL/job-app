from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row


@contextmanager
def rls_connection(
    database_url: str,
    *,
    user_id: Optional[str] = None,
    service: bool = False,
) -> Iterator[Connection]:
    """Open a transaction with an explicit, fail-closed RLS context."""
    if service == (user_id is not None):
        raise ValueError("Exactly one database access context is required.")

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set local role app_runtime")
            cursor.execute(
                "select set_config('app.current_user_id', %s, true)",
                (user_id or "",),
            )
            cursor.execute(
                "select set_config('app.service_access', %s, true)",
                ("true" if service else "false",),
            )
        yield connection
