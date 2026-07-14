from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel

from app.core.config import get_settings
from app.db.connection import rls_connection


class UserRecord(BaseModel):
    id: str
    email: str
    password_hash: str
    is_active: bool
    created_at: str
    updated_at: str


class RefreshTokenRecord(BaseModel):
    id: str
    user_id: str
    token_hash: str
    expires_at: str
    created_at: str
    revoked_at: Optional[str] = None


class UserRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _connection(self, *, user_id: Optional[str] = None, service: bool = False):
        return rls_connection(self.database_url, user_id=user_id, service=service)

    def create_user(self, *, email: str, password_hash: str) -> UserRecord:
        with self._connection(service=True) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.users (email, password_hash)
                values (%s, %s)
                returning id::text, email, password_hash, is_active, created_at::text, updated_at::text
                """,
                (email, password_hash),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("User insert did not return a record.")
            connection.commit()
        return UserRecord.model_validate(row)

    def fetch_user_by_id(self, *, user_id: str) -> Optional[UserRecord]:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                select id::text, email, password_hash, is_active, created_at::text, updated_at::text
                from public.users
                where id = %s
                """,
                (user_id,),
            )
            row = cursor.fetchone()
        return UserRecord.model_validate(row) if row else None

    def fetch_user_by_email(self, *, email: str) -> Optional[UserRecord]:
        with self._connection(service=True) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                select id::text, email, password_hash, is_active, created_at::text, updated_at::text
                from public.users
                where email = %s
                """,
                (email,),
            )
            row = cursor.fetchone()
        return UserRecord.model_validate(row) if row else None

    def update_user_password(self, *, user_id: str, password_hash: str) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                "update public.users set password_hash = %s where id = %s",
                (password_hash, user_id),
            )
            connection.commit()

    def update_user_email(self, *, user_id: str, email: str) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                "update public.users set email = %s where id = %s",
                (email, user_id),
            )
            connection.commit()

    def set_user_active(self, *, user_id: str, is_active: bool) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                "update public.users set is_active = %s where id = %s",
                (is_active, user_id),
            )
            connection.commit()

    def delete_user(self, *, user_id: str) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute("delete from public.users where id = %s", (user_id,))
            connection.commit()

    def create_refresh_token(self, *, user_id: str, token_hash: str, expires_at: str) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.refresh_tokens (user_id, token_hash, expires_at)
                values (%s, %s, %s::timestamptz)
                """,
                (user_id, token_hash, expires_at),
            )
            connection.commit()

    def fetch_refresh_token(self, *, token_hash: str) -> Optional[RefreshTokenRecord]:
        with self._connection(service=True) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                select id::text, user_id::text, token_hash, expires_at::text, created_at::text, revoked_at::text
                from public.refresh_tokens
                where token_hash = %s
                """,
                (token_hash,),
            )
            row = cursor.fetchone()
        return RefreshTokenRecord.model_validate(row) if row else None

    def revoke_refresh_token(self, *, token_hash: str) -> None:
        with self._connection(service=True) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                update public.refresh_tokens
                set revoked_at = %s
                where token_hash = %s and revoked_at is null
                """,
                (datetime.now(timezone.utc).isoformat(), token_hash),
            )
            connection.commit()

    def revoke_all_user_tokens(self, *, user_id: str) -> None:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                update public.refresh_tokens
                set revoked_at = %s
                where user_id = %s and revoked_at is null
                """,
                (datetime.now(timezone.utc).isoformat(), user_id),
            )
            connection.commit()

    def rotate_refresh_token(
        self,
        *,
        old_token_hash: str,
        user_id: str,
        new_token_hash: str,
        expires_at: str,
    ) -> bool:
        with self._connection(user_id=user_id) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                update public.refresh_tokens
                set revoked_at = %s
                where token_hash = %s and user_id = %s and revoked_at is null
                returning id
                """,
                (datetime.now(timezone.utc).isoformat(), old_token_hash, user_id),
            )
            if cursor.fetchone() is None:
                connection.rollback()
                return False
            cursor.execute(
                """
                insert into public.refresh_tokens (user_id, token_hash, expires_at)
                values (%s, %s, %s::timestamptz)
                """,
                (user_id, new_token_hash, expires_at),
            )
            connection.commit()
        return True


def get_user_repository() -> UserRepository:
    return UserRepository(get_settings().database_url)
