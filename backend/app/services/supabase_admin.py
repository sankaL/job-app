from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.core.config import Settings, get_settings


class SupabaseAdminError(RuntimeError):
    def __init__(self, message: str, *, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class SupabaseAdminClient:
    settings: Settings

    @property
    def _base_url(self) -> str:
        return self.settings.supabase_external_url.rstrip("/")

    @property
    def _service_role_key(self) -> str:
        key = (self.settings.supabase_service_role_key or "").strip()
        if not key:
            raise SupabaseAdminError("Supabase service-role key is not configured.")
        return key

    @property
    def _headers(self) -> dict[str, str]:
        key = self._service_role_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    async def create_user(self, *, email: str, password: str, email_confirm: bool = True) -> str:
        payload = {
            "email": email,
            "password": password,
            "email_confirm": email_confirm,
        }
        response = await self._request("POST", "/auth/v1/admin/users", payload)
        user_id = self._extract_user_id(response)
        if not user_id:
            raise SupabaseAdminError("Supabase user create response did not include a user id.")
        return user_id

    async def set_user_password(self, *, user_id: str, password: str) -> None:
        await self.update_user(
            user_id=user_id,
            updates={"password": password, "email_confirm": True},
        )

    async def update_user_email(self, *, user_id: str, email: str) -> None:
        await self.update_user(
            user_id=user_id,
            updates={"email": email, "email_confirm": True},
        )

    async def update_user(self, *, user_id: str, updates: dict[str, Any]) -> None:
        await self._request(
            "PUT",
            f"/auth/v1/admin/users/{user_id}",
            updates,
        )

    async def ban_user(self, *, user_id: str) -> None:
        await self._request(
            "PUT",
            f"/auth/v1/admin/users/{user_id}",
            {"ban_duration": "876000h"},
        )

    async def unban_user(self, *, user_id: str) -> None:
        await self._request(
            "PUT",
            f"/auth/v1/admin/users/{user_id}",
            {"ban_duration": "none"},
        )

    async def delete_user(self, *, user_id: str) -> None:
        await self._request("DELETE", f"/auth/v1/admin/users/{user_id}", None)

    async def _request(
        self,
        method: str,
        path: str,
        payload: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=self._headers,
                json=payload,
            )

        if response.status_code >= 400:
            detail = self._extract_error_detail(response)
            raise SupabaseAdminError(detail, status_code=response.status_code)

        if not response.content:
            return {}
        try:
            body = response.json()
        except ValueError as exc:
            raise SupabaseAdminError("Supabase admin response was not valid JSON.") from exc
        if not isinstance(body, dict):
            raise SupabaseAdminError("Supabase admin response was not an object.")
        return body

    @staticmethod
    def _extract_error_detail(response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return f"Supabase admin request failed with status {response.status_code}."

        if isinstance(body, dict):
            for key in ("msg", "message", "error_description", "error"):
                value = body.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

        return f"Supabase admin request failed with status {response.status_code}."

    @staticmethod
    def _extract_user_id(body: dict[str, Any]) -> Optional[str]:
        direct_id = body.get("id")
        if isinstance(direct_id, str) and direct_id.strip():
            return direct_id.strip()

        nested_user = body.get("user")
        if isinstance(nested_user, dict):
            nested_id = nested_user.get("id")
            if isinstance(nested_id, str) and nested_id.strip():
                return nested_id.strip()

        return None


def build_supabase_admin_client(settings: Optional[Settings] = None) -> SupabaseAdminClient:
    return SupabaseAdminClient(settings=settings or get_settings())
